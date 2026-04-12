import React, { useState } from "react";

interface FollowUpProps {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function FollowUp({ onSubmit, disabled, placeholder }: FollowUpProps) {
  const [question, setQuestion] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim()) {
      onSubmit(question.trim());
      setQuestion("");
    }
  };

  return (
    <form className="follow-up" onSubmit={handleSubmit}>
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={placeholder || "Ask a follow-up..."}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !question.trim()}>
        Ask
      </button>
    </form>
  );
}
