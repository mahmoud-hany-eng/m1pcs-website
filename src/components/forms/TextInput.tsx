import { InputHTMLAttributes } from "react";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`glass-input min-h-[3.25rem] px-4 py-3 text-base ${
        props.className ?? ""
      }`}
    />
  );
}
