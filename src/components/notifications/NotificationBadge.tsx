"use client";

import React from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';

interface NotificationBadgeProps {
  onClick: () => void;
  className?: string;
}

export const NotificationBadge = ({ onClick, className }: NotificationBadgeProps) => {
  const { newNotificationsCount, isLoading } = useNotifications();

  if (isLoading) {
    return (
      <div className="relative h-8 w-8 rounded-full bg-muted animate-pulse"></div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        "relative h-8 w-8 rounded-full text-foreground hover:bg-muted/50 transition-colors pointer-events-auto",
        className
      )}
      title="View Notifications"
    >
      <Bell className="h-5 w-5" />
      {newNotificationsCount > 0 && (
        <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
          {newNotificationsCount}
        </span>
      )}
    </Button>
  );
};