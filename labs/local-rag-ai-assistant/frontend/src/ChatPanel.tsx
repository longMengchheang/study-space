import { useEffect, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
};

type ChatPanelProps = {
  messages: Message[];
  isTyping: boolean;
  /** Extra dependency to trigger scroll-to-bottom */
  scrollTrigger?: string;
  children?: React.ReactNode;
};

export default function ChatPanel(props: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [props.messages, props.isTyping, props.scrollTrigger]);

  return (
    <div className="chat-messages">
      {props.children}

      {props.messages.map((msg) => (
        <div key={msg.id} className={`message-wrapper ${msg.role}`}>
          <div className={`message-avatar ${msg.role === 'ai' ? 'avatar-ai' : 'avatar-user'}`}>
            {msg.role === 'ai' ? <Bot size={20} /> : <User size={20} />}
          </div>
          <div className="message-content">
            {msg.role === 'ai' ? (
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
        </div>
      ))}

      {props.isTyping && (
        <div className="message-wrapper ai">
          <div className="message-avatar avatar-ai">
            <Bot size={20} />
          </div>
          <div className="message-content typing-shell">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
