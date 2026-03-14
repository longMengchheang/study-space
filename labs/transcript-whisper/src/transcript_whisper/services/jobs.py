from __future__ import annotations

from dataclasses import dataclass, field
from threading import Condition
from threading import Lock
from typing import Any, Optional
from uuid import uuid4


@dataclass
class JobRecord:
    job_id: str
    status: str = "queued"
    phase: str = "queued"
    percent: int = 0
    message: str = "Queued"
    cancel_requested: bool = False
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    version: int = 0


class JobService:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = Lock()
        self._condition = Condition(self._lock)

    def create_job(self, *, message: str = "Queued") -> JobRecord:
        record = JobRecord(job_id=uuid4().hex, message=message)
        with self._lock:
            self._jobs[record.job_id] = record
            self._condition.notify_all()
        return record

    def get_job(self, job_id: str) -> Optional[JobRecord]:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                return None
            return JobRecord(**record.__dict__)

    def update_job(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        phase: Optional[str] = None,
        percent: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        result: Optional[dict[str, Any]] = None,
    ) -> JobRecord:
        with self._lock:
            record = self._jobs[job_id]
            if status is not None:
                record.status = status
            if phase is not None:
                record.phase = phase
            if percent is not None:
                record.percent = max(0, min(100, int(percent)))
            if message is not None:
                record.message = message
            if error is not None:
                record.error = error
            if result is not None:
                record.result = result
            record.version += 1
            self._condition.notify_all()
            return JobRecord(**record.__dict__)

    def request_cancel(self, job_id: str) -> JobRecord:
        with self._lock:
            record = self._jobs[job_id]
            record.cancel_requested = True
            if record.status == "queued":
                record.status = "canceled"
                record.phase = "canceled"
                record.message = "Canceled."
            record.version += 1
            self._condition.notify_all()
            return JobRecord(**record.__dict__)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            record = self._jobs.get(job_id)
            return bool(record and record.cancel_requested)

    def complete_job(self, job_id: str, *, result: dict[str, Any], message: str) -> JobRecord:
        return self.update_job(
            job_id,
            status="completed",
            phase="completed",
            percent=100,
            message=message,
            result=result,
            error=None,
        )

    def fail_job(self, job_id: str, *, error: str) -> JobRecord:
        return self.update_job(
            job_id,
            status="failed",
            phase="failed",
            message=error,
            error=error,
        )

    def cancel_job(self, job_id: str, *, message: str = "Canceled.") -> JobRecord:
        return self.update_job(
            job_id,
            status="canceled",
            phase="canceled",
            message=message,
            error=None,
        )

    def wait_for_update(
        self,
        job_id: str,
        *,
        last_version: int,
        timeout: float = 10.0,
    ) -> Optional[JobRecord]:
        with self._condition:
            if job_id not in self._jobs:
                return None

            current = self._jobs[job_id]
            if current.version > last_version:
                return JobRecord(**current.__dict__)

            self._condition.wait_for(
                lambda: job_id not in self._jobs or self._jobs[job_id].version > last_version,
                timeout=timeout,
            )

            current = self._jobs.get(job_id)
            if current is None or current.version <= last_version:
                return None

            return JobRecord(**current.__dict__)
