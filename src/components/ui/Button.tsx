import Link from "next/link";
import { ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "glass" | "whatsapp";
type Size = "sm" | "md" | "lg";

/*
 * Primary/secondary/WhatsApp are opaque, lit-from-above pills (inner top
 * highlight + a light sweep on hover); outline/glass is the clear glass
 * pill. All share `.btn-sheen` from globals.css — hover lifts 1px and
 * sweeps light across, it never scales.
 */
const base =
  "btn-sheen inline-flex items-center justify-center gap-2 rounded-full font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none text-center";

const variants: Record<Variant, string> = {
  primary: "btn-red",
  secondary: "btn-gold",
  outline: "btn-glass",
  glass: "btn-glass",
  whatsapp: "btn-whatsapp",
};

const sizes: Record<Size, string> = {
  sm: "px-5 py-2.5 text-sm",
  md: "px-5 py-3 text-sm sm:text-base",
  lg: "px-7 py-4 text-base sm:text-lg",
};

interface CommonProps {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}

interface ButtonAsLink extends CommonProps {
  href: string;
  external?: boolean;
  onClick?: never;
  type?: never;
}

interface ButtonAsButton extends CommonProps {
  href?: never;
  external?: never;
  onClick?: () => void;
  type?: "button" | "submit";
}

type ButtonProps = ButtonAsLink | ButtonAsButton;

export function Button(props: ButtonProps) {
  const { children, variant = "primary", size = "md", className = "" } = props;
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if ("href" in props && props.href) {
    if (props.external) {
      return (
        <a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      className={classes}
    >
      {children}
    </button>
  );
}
