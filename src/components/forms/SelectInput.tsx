import { SelectHTMLAttributes } from "react";

/**
 * Native <select>, styled to match TextInput. Used for choices too long for
 * a pill group (e.g. the main "what do you want a quote for?" field) —
 * a native select is also the most reliably keyboard- and screen-reader-
 * accessible control for a long option list on mobile.
 */
export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`glass-input min-h-[3.25rem] cursor-pointer px-4 py-3 text-base ${
        props.className ?? ""
      }`}
    />
  );
}
