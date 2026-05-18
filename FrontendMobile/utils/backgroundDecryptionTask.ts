import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { DecryptionWorker } from './DecryptionWorker';

const GHOST_NOTIFICATION_TASK = 'GHOST_NOTIFICATION_TASK';

/**
 * Register the background task for handling data-only FCM messages.
 */
TaskManager.defineTask(GHOST_NOTIFICATION_TASK, async ({ data, error }: { data: any, error: any }) => {
  if (error) {
    console.error('Background task error:', error);
    return;
  }

  if (data) {
    const { notification } = data; // For some versions of expo-notifications
    const remoteData = data.remoteMessage?.data || data;

    // Trigger the decryption process
    const { title, body } = await DecryptionWorker.decryptNotification(remoteData);

    // Schedule the local notification to be shown immediately
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // show immediately
    });
  }
});

/**
 * Configure notifications to show even when app is in foreground.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export { GHOST_NOTIFICATION_TASK };
