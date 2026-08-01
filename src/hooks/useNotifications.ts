import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveNotifications, getSeenNotificationIds, markNotificationsAsSeen, Notification } from '@/services/notificationService';

interface UseNotificationsReturn {
  notifications: Notification[];
  newNotificationsCount: number;
  isLoading: boolean;
  isError: boolean;
  markAllAsSeen: () => Promise<void>;
}

export const useNotifications = (): UseNotificationsReturn => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Query for active notifications from the text file
  const { data: activeNotifications = [], isLoading: isLoadingActive, isError: isErrorActive } = useQuery<Notification[], Error>({
    queryKey: ['activeNotifications'],
    queryFn: getActiveNotifications,
    staleTime: 1000 * 60 * 5, // Data considered fresh for 5 minutes
    refetchOnWindowFocus: true,
  });

  // Query for seen notification IDs from IndexedDB for the current user
  const { data: seenNotificationIds = new Set<string>(), isLoading: isLoadingSeen, isError: isErrorSeen } = useQuery<Set<string>, Error>({
    queryKey: ['seenNotificationIds', user?.id],
    queryFn: () => user ? getSeenNotificationIds(user.id) : Promise.resolve(new Set<string>()),
    enabled: !!user, // Only run if user is logged in
    staleTime: 1000 * 60 * 1, // Seen status can be refreshed more frequently
    refetchOnWindowFocus: true,
  });

  // Determine new notifications
  const newNotifications = activeNotifications.filter(notif => !seenNotificationIds.has(notif.id));
  const newNotificationsCount = newNotifications.length;

  // Mutation to mark notifications as seen
  const markAsSeenMutation = useMutation<void, Error, string[]>({
    mutationFn: async (notificationIds: string[]) => {
      if (user) {
        await markNotificationsAsSeen(user.id, notificationIds);
      } else {
        throw new Error("User not authenticated to mark notifications as seen.");
      }
    },
    onSuccess: () => {
      // Invalidate the seenNotificationIds query to refetch and update the count
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds', user?.id] });
    },
    onError: (error) => {
      console.error("Failed to mark notifications as seen:", error);
    }
  });

  const markAllAsSeen = async () => {
    if (user && newNotifications.length > 0) {
      const idsToMark = newNotifications.map(notif => notif.id);
      await markAsSeenMutation.mutateAsync(idsToMark);
    }
  };

  return {
    notifications: activeNotifications,
    newNotificationsCount,
    isLoading: isLoadingActive || isLoadingSeen,
    isError: isErrorActive || isErrorSeen,
    markAllAsSeen,
  };
};