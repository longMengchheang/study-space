import { Send } from 'lucide-react';

type InputBarProps = {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
};

export default function InputBar(props: InputBarProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      props.onSend();
    }
  }

  return (
    <div className="input-area">
      <div className="input-container">
        <textarea
          className="chat-input"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder}
          rows={1}
        />
        <button
          className="send-button"
          onClick={props.onSend}
          disabled={!props.value.trim() || props.disabled}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
