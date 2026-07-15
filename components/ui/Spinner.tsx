import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ui";

const SIZE_CLASSES: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-6 h-6",
};

interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  return <Loader2 className={cn(SIZE_CLASSES[size], "animate-spin", className)} />;
}
