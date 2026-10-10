import { TextareaHTMLAttributes } from "react";

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`glass-input px-4 py-3 text-base leading-relaxed ${
        props.className ?? ""
      }`}
    />
  );
}
