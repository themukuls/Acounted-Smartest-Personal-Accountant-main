"use client";

import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Bell, Link as LinkIcon, AlertCircle, RefreshCw } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { NudgeSettings } from './NudgeSettings';
import { formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';

interface NotificationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatRelativeDate = (date: Date): string => {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return formatDistanceToNow(date, { addSuffix: true });
};

export const NotificationPanel = ({ open, onOpenChange }: NotificationPanelProps) => {
  const { notifications, newNotificationsCount, isLoading, isError, markAllAsSeen } = useNotifications();

  // Snapshot which IDs are "new" before marking them seen
  const [newIds, setNewIds] = React.useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      if (newNotificationsCount > 0) {
        // Capture new IDs before marking as seen so we can highlight them
        const ids = new Set(
          notifications
            .filter((_, i) => i < newNotificationsCount)
            .map(n => n.id)
        );
        setNewIds(ids);
        markAllAsSeen();
      } else {
        setNewIds(new Set());
      }
    }
  }, [open]);

  const renderText = (text: string) => {
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    let lastIndex = 0;
    const parts: React.ReactNode[] = [];

    text.replace(linkRegex, (match, linkText, url, offset) => {
      if (offset > lastIndex) {
        parts.push(<span key={`t-${lastIndex}`}>{DOMPurify.sanitize(text.substring(lastIndex, offset))}</span>);
      }
      parts.push(
        <a key={`l-${offset}`} href={DOMPurify.sanitize(url)} target="_blank" rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5 pointer-events-auto font-medium">
          {DOMPurify.sanitize(linkText)} <LinkIcon className="h-3 w-3" />
        </a>
      );
      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < text.length) {
      parts.push(<span key={`t-${lastIndex}`}>{DOMPurify.sanitize(text.substring(lastIndex))}</span>);
    }

    return <p className="text-xs text-muted-foreground leading-relaxed">{parts}</p>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[88vh] overflow-hidden flex flex-col bg-background border border-border/60 shadow-2xl pointer-events-auto p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Bell className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <DialogTitle className="text-base font-bold text-foreground">
                Notifications
              </DialogTitle>
              {newNotificationsCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold shrink-0">
                  {newNotificationsCount} new
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="updates" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 grid grid-cols-2 shrink-0 pointer-events-auto">
            <TabsTrigger value="updates" className="text-xs pointer-events-auto">
              Updates
            </TabsTrigger>
            <TabsTrigger value="reminders" className="text-xs pointer-events-auto">
              Reminders
            </TabsTrigger>
          </TabsList>

          {/* ── Reminders: the nudge engine's controls + live preview ── */}
          <TabsContent
            value="reminders"
            className="flex-1 overflow-y-auto px-4 py-3 mt-0 focus-visible:outline-none"
          >
            <NudgeSettings />
          </TabsContent>

        {/* ── Content ── */}
        <TabsContent
          value="updates"
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2 mt-0 focus-visible:outline-none"
        >

          {/* Loading — skeleton cards */}
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-border/40 p-4 space-y-2 animate-pulse">
                  <div className="h-3 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Couldn't load notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">Check your connection and try again</p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors pointer-events-auto"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-14 w-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                <Bell className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">You're all caught up</p>
                <p className="text-xs text-muted-foreground mt-0.5">No notifications yet. Check back later.</p>
              </div>
            </div>
          )}

          {/* Notification list */}
          {!isLoading && !isError && notifications.length > 0 && (
            <div className="space-y-2">
              {notifications.map((notif) => {
                const isNew = newIds.has(notif.id);
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "relative rounded-xl border p-3 pl-4 transition-all",
                      isNew
                        ? "bg-primary/5 border-primary/20"
                        : "bg-background/60 border-border/40"
                    )}
                  >
                    {/* Left accent bar for new */}
                    {isNew && (
                      <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary" />
                    )}

                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className={cn(
                        "text-xs font-bold leading-tight",
                        isNew ? "text-foreground" : "text-foreground/80"
                      )}>
                        {notif.heading}
                      </h3>
                      {isNew && (
                        <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-0.5" />
                      )}
                    </div>

                    {renderText(notif.text)}

                    <p className="text-[10px] text-muted-foreground mt-2">
                      {formatRelativeDate(notif.date)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
