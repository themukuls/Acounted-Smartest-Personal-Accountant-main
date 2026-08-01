import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  variant?: "default" | "primary" | "secondary" | "success" | "warning";
  onClick?: () => void;
}

export const GlassCard = ({ children, className, hover = true, variant = "default", onClick }: GlassCardProps) => {
  const variantStyles = {
    default: "glass-card",
    primary: "glass-card bg-gradient-to-br from-primary/10 to-primary-glow/10 border-primary/20",
    secondary: "glass-card bg-gradient-to-br from-secondary/10 to-accent/10 border-secondary/20",
    success: "glass-card bg-gradient-to-br from-success/10 to-success/5 border-success/20",
    warning: "glass-card bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20"
  };

  return (
    <div 
      className={cn(
        variantStyles[variant],
        "animated-bg",
        hover && "hover-lift",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
};