package dev.mushroomhollow.photos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that runs periodic backup checks.
 * Posts a notification when it's time to backup.
 * The web app handles the actual scanning/uploading when opened.
 */
public class BackupForegroundService extends Service {

    private static final String CHANNEL_ID = "spore_photos_backup";
    private static final int NOTIFICATION_ID = 1001;
    public static final String ACTION_START = "START";
    public static final String ACTION_STOP = "STOP";
    public static final String EXTRA_INTERVAL = "INTERVAL";

    private static boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    private Handler handler;
    private Runnable backupRunnable;
    private long intervalMs = 60 * 60 * 1000; // default: 1 hour

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP.equals(action)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            if (intent.hasExtra(EXTRA_INTERVAL)) {
                intervalMs = intent.getLongExtra(EXTRA_INTERVAL, intervalMs);
            }
        }

        startForeground(NOTIFICATION_ID, buildNotification("Backup service running", "Checking every " + (intervalMs / 60000) + " minutes"));

        running = true;

        // Schedule periodic backup checks
        backupRunnable = new Runnable() {
            @Override
            public void run() {
                notifyBackupTime();
                handler.postDelayed(this, intervalMs);
            }
        };
        handler.postDelayed(backupRunnable, intervalMs);

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (handler != null && backupRunnable != null) {
            handler.removeCallbacks(backupRunnable);
        }
        super.onDestroy();
    }

    private void notifyBackupTime() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("run_backup", true);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = buildNotification(
            "Time to backup photos",
            "Tap to open Spore-Photos and run backup"
        );

        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID + 1, notification);

        // Also update the foreground notification
        updateForegroundNotification("Backup check complete", "Next check in " + (intervalMs / 60000) + " minutes");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Photo Backup",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Background photo backup service notifications");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String title, String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateForegroundNotification(String title, String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(title, text));
    }
}
