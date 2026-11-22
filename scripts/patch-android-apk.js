'use strict';
/**
 * SpotyFlow Native Android Patcher (scripts/patch-android-apk.js)
 * Combines:
 *  1. Vivo Origin Island official whitelist (dynamic appId from capacitor.config.json = com.netease.cloudmusic,
 *     appName = SpotyFlow, zero duplicate com/spotyflow/music files, zero NativeYouTubeResolver.java)
 *  2. Lightweight AndroidX Media3 1.4.1 (media3-common + media3-session + Guava, NO ExoPlayer bloat)
 *     using SimpleBasePlayer + ForwardingPlayer + DefaultMediaNotificationProvider + 4 Spotify Notification Channels
 *     + android:appCategory="audio" + 14 Spotify permissions + WakeLock/WifiLock + ACTION_AUDIO_BECOMING_NOISY
 *  3. Background & Lockscreen YouTube WebView Keep-Alive via SpotyFlowWebView (onWindowVisibilityChanged override
 *     + bridge_layout_main.xml override + MainActivity onPause/onStop resumeTimers)
 *  4. @JavascriptInterface "SpotyFlowMediaBridge" (updateState, stopService, openExternalUrl, clearHttpCache)
 *     + Chrome Google OAuth spotyflow:// deep link
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CAP_CONFIG_PATH = path.join(ROOT, 'capacitor.config.json');
const ANDROID_DIR = path.join(ROOT, 'android');
const VARIABLES_GRADLE = path.join(ANDROID_DIR, 'variables.gradle');
const APP_DIR = path.join(ANDROID_DIR, 'app');
const BUILD_GRADLE = path.join(APP_DIR, 'build.gradle');
const MANIFEST_XML = path.join(APP_DIR, 'src', 'main', 'AndroidManifest.xml');
const JAVA_ROOT_DIR = path.join(APP_DIR, 'src', 'main', 'java');
const RES_LAYOUT_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'layout');
const RES_DRAWABLE_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'drawable');

function readDynamicAppId() {
  if (!fs.existsSync(CAP_CONFIG_PATH)) {
    throw new Error(`Tidak ditemukan ${CAP_CONFIG_PATH}`);
  }
  const cfg = JSON.parse(fs.readFileSync(CAP_CONFIG_PATH, 'utf8'));
  const appId = String(cfg.appId || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(appId)) {
    throw new Error(`appId di capacitor.config.json tidak valid: "${appId}"`);
  }
  return appId;
}

const APP_ID = readDynamicAppId();
const JAVA_PKG_DIR = path.join(JAVA_ROOT_DIR, ...APP_ID.split('.'));

const IC_STAT_MUSIC_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,3v10.55c-0.59,-0.34 -1.27,-0.55 -2,-0.55 -2.21,0 -4,1.79 -4,4s1.79,4 4,4 4,-1.79 4,-4V7h4V3h-6z" />
</vector>
`;

const SPOTYFLOW_WEBVIEW_JAVA = `package ${APP_ID};

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

import java.util.Map;

public class SpotyFlowWebView extends CapacitorWebView {
    private boolean mediaBridgeAttached = false;

    public SpotyFlowWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    private void ensureBridgeBeforeLoad() {
        if (mediaBridgeAttached) return;
        mediaBridgeAttached = true;
        MainActivity.attachMediaBridgeToWebView(this);
    }

    @Override
    public void loadUrl(String url) {
        ensureBridgeBeforeLoad();
        super.loadUrl(url);
    }

    @Override
    public void loadUrl(String url, Map<String, String> additionalHttpHeaders) {
        ensureBridgeBeforeLoad();
        super.loadUrl(url, additionalHttpHeaders);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != View.VISIBLE && SpotyFlowPlaybackService.isPlaying) {
            super.onWindowVisibilityChanged(View.VISIBLE);
            return;
        }
        super.onWindowVisibilityChanged(visibility);
    }

    @Override
    public void onPause() {
        if (SpotyFlowPlaybackService.isPlaying) {
            return;
        }
        super.onPause();
    }

    @Override
    public void pauseTimers() {
        if (SpotyFlowPlaybackService.isPlaying) {
            return;
        }
        super.pauseTimers();
    }
}
`;

const BRIDGE_LAYOUT_MAIN_XML = `<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    tools:context=".MainActivity">

    <${APP_ID}.SpotyFlowWebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`;

const SPOTYFLOW_PLAYBACK_SERVICE_JAVA = `package ${APP_ID};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

@UnstableApi
public class SpotyFlowPlaybackService extends MediaSessionService {
    public static final String CHANNEL_GENERAL = "spotyflow_general";
    public static final String CHANNEL_PLAYBACK = "spotyflow_playback";
    public static final String CHANNEL_MUSIC = "spotyflow_music";
    public static final String CHANNEL_DOWNLOADS = "spotyflow_downloads";

    public static volatile SpotyFlowPlaybackService instance = null;
    public static volatile boolean isPlaying = false;
    private static volatile String pendingJsonPayload = null;

    private Handler mainHandler;
    private SpotyFlowRemotePlayer remotePlayer;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean noisyReceiverRegistered = false;

    private final BroadcastReceiver becomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                if (isPlaying) {
                    isPlaying = false;
                    updateWakeAndWifiLocks(false);
                    if (remotePlayer != null) {
                        remotePlayer.setLocalPlayingState(false);
                    }
                    MainActivity.sendMediaActionToJs("noisy", 0L);
                }
            }
        }
    };

    public static void ensureNotificationChannels(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            NotificationChannel general = new NotificationChannel(
                    CHANNEL_GENERAL,
                    "SpotyFlow",
                    NotificationManager.IMPORTANCE_HIGH
            );
            general.setDescription("Notifikasi utama, pembaruan & info sesi SpotyFlow");
            general.setShowBadge(true);
            general.enableVibration(true);
            general.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(general);

            NotificationChannel playback = new NotificationChannel(
                    CHANNEL_PLAYBACK,
                    "Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            playback.setDescription("Kontrol pemutaran musik latar belakang, layar kunci & kapsul media");
            playback.setSound(null, null);
            playback.enableVibration(false);
            playback.enableLights(false);
            playback.setShowBadge(false);
            playback.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(playback);

            NotificationChannel music = new NotificationChannel(
                    CHANNEL_MUSIC,
                    "SpotyFlow Music",
                    NotificationManager.IMPORTANCE_LOW
            );
            music.setDescription("Rekomendasi rilis baru, playlist & aktivitas musik SpotyFlow");
            music.setSound(null, null);
            music.enableVibration(false);
            music.setShowBadge(false);
            music.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(music);

            NotificationChannel downloads = new NotificationChannel(
                    CHANNEL_DOWNLOADS,
                    "Offline & Unduhan",
                    NotificationManager.IMPORTANCE_LOW
            );
            downloads.setDescription("Status penyimpanan lagu offline SpotyFlow");
            downloads.setSound(null, null);
            downloads.enableVibration(false);
            downloads.setShowBadge(false);
            manager.createNotificationChannel(downloads);
        } catch (Exception ignored) {
        }
    }

    /**
     * Android 12-15 safe state update:
     * - If service instance is already alive -> update directly on Main Thread (zero ForegroundServiceStartNotAllowedException!)
     * - If service is not yet started -> queue pending payload and start foreground service safely.
     */
    public static void dispatchStateUpdate(Context ctx, String jsonPayload) {
        if (jsonPayload == null || jsonPayload.isEmpty()) return;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> svc.applyJsonState(jsonPayload));
            return;
        }
        pendingJsonPayload = jsonPayload;
        if (ctx != null) {
            try {
                Intent intent = new Intent(ctx, SpotyFlowPlaybackService.class);
                ContextCompat.startForegroundService(ctx, intent);
            } catch (Throwable ignored) {
                try {
                    ctx.startService(new Intent(ctx, SpotyFlowPlaybackService.class));
                } catch (Throwable ignored2) {
                }
            }
        }
    }

    public static void requestStopService(Context ctx) {
        isPlaying = false;
        pendingJsonPayload = null;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> {
                svc.updateWakeAndWifiLocks(false);
                if (svc.remotePlayer != null) {
                    svc.remotePlayer.setLocalPlayingState(false);
                }
                try {
                    svc.stopForeground(STOP_FOREGROUND_REMOVE);
                } catch (Throwable ignored) {
                }
                svc.stopSelf();
            });
            return;
        }
        if (ctx != null) {
            try {
                ctx.stopService(new Intent(ctx, SpotyFlowPlaybackService.class));
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        mainHandler = new Handler(Looper.getMainLooper());

        ensureNotificationChannels(this);

        // Official Media3 Notification Provider (Playback channel + crisp white music note vector + async artworkUri loader)
        DefaultMediaNotificationProvider notificationProvider =
                new DefaultMediaNotificationProvider.Builder(this)
                        .setChannelId(CHANNEL_PLAYBACK)
                        .build();
        notificationProvider.setSmallIcon(R.drawable.ic_stat_music);
        setMediaNotificationProvider(notificationProvider);

        // SimpleBasePlayer mirrors YouTube/WebView state to Origin Island / Lockscreen / TWS without fighting Audio Focus!
        remotePlayer = new SpotyFlowRemotePlayer(Looper.getMainLooper());

        ForwardingPlayer forwardingPlayer = new ForwardingPlayer(remotePlayer) {
            @NonNull
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(COMMAND_SEEK_TO_NEXT)
                        .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(COMMAND_SEEK_TO_PREVIOUS)
                        .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == COMMAND_SEEK_TO_NEXT
                        || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                        || command == COMMAND_SEEK_TO_PREVIOUS
                        || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public boolean hasNextMediaItem() {
                return true;
            }

            @Override
            public boolean hasPreviousMediaItem() {
                return true;
            }

            @Override
            public void seekToNext() {
                MainActivity.sendMediaActionToJs("next", 0L);
            }

            @Override
            public void seekToNextMediaItem() {
                MainActivity.sendMediaActionToJs("next", 0L);
            }

            @Override
            public void seekToPrevious() {
                MainActivity.sendMediaActionToJs("prev", 0L);
            }

            @Override
            public void seekToPreviousMediaItem() {
                MainActivity.sendMediaActionToJs("prev", 0L);
            }
        };

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(
                this,
                100,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        mediaSession = new MediaSession.Builder(this, forwardingPlayer)
                .setSessionActivity(openAppPendingIntent)
                .build();

        initWakeAndWifiLocks();
        registerBecomingNoisyReceiver();

        String queued = pendingJsonPayload;
        pendingJsonPayload = null;
        if (queued != null && !queued.isEmpty()) {
            mainHandler.post(() -> applyJsonState(queued));
        }
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        String queued = pendingJsonPayload;
        pendingJsonPayload = null;
        if (queued != null && !queued.isEmpty()) {
            applyJsonState(queued);
        }
        if (mediaSession != null) {
            try {
                onUpdateNotification(mediaSession, true);
            } catch (Throwable ignored) {
            }
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        if (!isPlaying) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        isPlaying = false;
        updateWakeAndWifiLocks(false);
        unregisterBecomingNoisyReceiver();
        if (mediaSession != null) {
            try {
                mediaSession.release();
            } catch (Exception ignored) {
            }
            mediaSession = null;
        }
        if (remotePlayer != null) {
            try {
                remotePlayer.release();
            } catch (Exception ignored) {
            }
            remotePlayer = null;
        }
        super.onDestroy();
    }

    private void initWakeAndWifiLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SpotyFlow::BackgroundAudioWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Throwable ignored) {
        }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(mode, "SpotyFlow::BackgroundWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Throwable ignored) {
        }
    }

    private void updateWakeAndWifiLocks(boolean active) {
        try {
            if (wakeLock != null) {
                if (active && !wakeLock.isHeld()) {
                    wakeLock.acquire(4L * 60L * 60L * 1000L);
                } else if (!active && wakeLock.isHeld()) {
                    wakeLock.release();
                }
            }
        } catch (Throwable ignored) {
        }
        try {
            if (wifiLock != null) {
                if (active && !wifiLock.isHeld()) {
                    wifiLock.acquire();
                } else if (!active && wifiLock.isHeld()) {
                    wifiLock.release();
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private void registerBecomingNoisyReceiver() {
        if (noisyReceiverRegistered) return;
        try {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            ContextCompat.registerReceiver(this, becomingNoisyReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
            noisyReceiverRegistered = true;
        } catch (Throwable ignored) {
        }
    }

    private void unregisterBecomingNoisyReceiver() {
        if (!noisyReceiverRegistered) return;
        try {
            unregisterReceiver(becomingNoisyReceiver);
        } catch (Throwable ignored) {
        }
        noisyReceiverRegistered = false;
    }

    public void applyJsonState(String jsonPayload) {
        if (jsonPayload == null || jsonPayload.isEmpty() || remotePlayer == null) return;
        try {
            JSONObject obj = new JSONObject(jsonPayload);
            String trackId = obj.optString("trackId", "track");
            if (trackId.isEmpty()) trackId = "track";
            String title = obj.optString("title", "SpotyFlow");
            if (title.isEmpty()) title = "SpotyFlow";
            String artist = obj.optString("artist", "SpotyFlow");
            if (artist.isEmpty()) artist = "SpotyFlow";
            String album = obj.optString("album", "SpotyFlow");
            if (album.isEmpty()) album = "SpotyFlow";
            String coverUrl = obj.optString("coverUrl", "https://spotyflow.vercel.app/icon-512.png");
            if (!coverUrl.startsWith("https://") && !coverUrl.startsWith("http://")) {
                coverUrl = "https://spotyflow.vercel.app/icon-512.png";
            }
            boolean playingNow = obj.optBoolean("isPlaying", false);
            long durationMs = Math.max(1000L, obj.optLong("durationMs", 210000L));
            long positionMs = Math.max(0L, obj.optLong("positionMs", 0L));
            float playbackRate = (float) obj.optDouble("playbackRate", 1.0);
            if (playbackRate <= 0.1f || playbackRate > 4.0f) playbackRate = 1.0f;

            boolean wasPlaying = isPlaying;
            isPlaying = playingNow;
            updateWakeAndWifiLocks(playingNow);

            remotePlayer.updateFromJs(
                    trackId, title, artist, album, coverUrl,
                    playingNow, durationMs, positionMs, playbackRate
            );

            if (mediaSession != null && (playingNow || wasPlaying)) {
                try {
                    onUpdateNotification(mediaSession, playingNow);
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * Media3 SimpleBasePlayer proxy that mirrors WebView/YouTube playback state cleanly
     * without requesting or clashing with WebView Audio Focus.
     */
    private static class SpotyFlowRemotePlayer extends SimpleBasePlayer {
        private boolean hasTrack = false;
        private String trackId = "track";
        private String title = "SpotyFlow";
        private String artist = "SpotyFlow";
        private String album = "SpotyFlow";
        private String coverUrl = "https://spotyflow.vercel.app/icon-512.png";
        private boolean playing = false;
        private long durationMs = 210000L;
        private long anchorPosMs = 0L;
        private long anchorRealtimeMs = SystemClock.elapsedRealtime();
        private float playbackRate = 1.0f;

        private final PositionSupplier livePositionSupplier = () -> {
            if (!playing) return anchorPosMs;
            long delta = SystemClock.elapsedRealtime() - anchorRealtimeMs;
            long est = anchorPosMs + (long) (delta * playbackRate);
            return durationMs > 0L ? Math.min(est, durationMs) : Math.max(0L, est);
        };

        SpotyFlowRemotePlayer(Looper looper) {
            super(looper);
        }

        void updateFromJs(
                String trackId, String title, String artist, String album, String coverUrl,
                boolean playing, long durationMs, long positionMs, float playbackRate
        ) {
            this.hasTrack = true;
            this.trackId = trackId;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.coverUrl = coverUrl;
            this.playing = playing;
            this.durationMs = durationMs;
            this.anchorPosMs = positionMs;
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playbackRate = playbackRate;
            invalidateState();
        }

        void setLocalPlayingState(boolean playingNow) {
            this.anchorPosMs = livePositionSupplier.get();
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playing = playingNow;
            invalidateState();
        }

        @NonNull
        @Override
        protected State getState() {
            Commands commands = new Commands.Builder()
                    .addAll(
                            Player.COMMAND_PLAY_PAUSE,
                            Player.COMMAND_STOP,
                            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                            Player.COMMAND_SEEK_TO_NEXT,
                            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                            Player.COMMAND_SEEK_TO_PREVIOUS,
                            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                            Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                            Player.COMMAND_GET_METADATA,
                            Player.COMMAND_GET_TIMELINE
                    )
                    .build();

            State.Builder builder = new State.Builder()
                    .setAvailableCommands(commands)
                    .setPlayWhenReady(playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                    .setPlaybackState(hasTrack ? Player.STATE_READY : Player.STATE_IDLE)
                    .setPlaybackParameters(new PlaybackParameters(playbackRate));

            if (hasTrack) {
                String safeCover = (coverUrl != null && coverUrl.startsWith("http"))
                        ? coverUrl
                        : "https://spotyflow.vercel.app/icon-512.png";
                MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(artist)
                        .setAlbumTitle(album)
                        .setDisplayTitle(title)
                        .setSubtitle(artist)
                        .setArtworkUri(Uri.parse(safeCover))
                        .build();

                MediaItem mediaItem = new MediaItem.Builder()
                        .setMediaId(trackId)
                        .setMediaMetadata(metadata)
                        .build();

                MediaItemData itemData = new MediaItemData.Builder(trackId)
                        .setMediaItem(mediaItem)
                        .setMediaMetadata(metadata)
                        .setDurationUs(durationMs > 0L ? durationMs * 1000L : C.TIME_UNSET)
                        .setIsSeekable(true)
                        .build();

                List<MediaItemData> playlist = Collections.singletonList(itemData);
                builder.setPlaylist(playlist);
                builder.setCurrentMediaItemIndex(0);
                builder.setContentPositionMs(livePositionSupplier);
            } else {
                builder.setPlaylist(Collections.emptyList());
            }

            return builder.build();
        }

        @NonNull
        @Override
        protected ListenableFuture<?> handlePrepare() {
            invalidateState();
            return Futures.immediateVoidFuture();
        }

        @NonNull
        @Override
        protected ListenableFuture<?> handleSetPlayWhenReady(boolean playWhenReady) {
            this.anchorPosMs = livePositionSupplier.get();
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playing = playWhenReady;
            SpotyFlowPlaybackService.isPlaying = playWhenReady;
            SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
            if (svc != null) {
                svc.updateWakeAndWifiLocks(playWhenReady);
            }
            invalidateState();
            MainActivity.sendMediaActionToJs(playWhenReady ? "play" : "pause", 0L);
            return Futures.immediateVoidFuture();
        }

        @NonNull
        @Override
        protected ListenableFuture<?> handleSeek(int mediaItemIndex, long positionMs, int seekCommand) {
            if (seekCommand == Player.COMMAND_SEEK_TO_NEXT
                    || seekCommand == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) {
                MainActivity.sendMediaActionToJs("next", 0L);
            } else if (seekCommand == Player.COMMAND_SEEK_TO_PREVIOUS
                    || seekCommand == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                MainActivity.sendMediaActionToJs("prev", 0L);
            } else if (positionMs != C.TIME_UNSET) {
                this.anchorPosMs = Math.max(0L, positionMs);
                this.anchorRealtimeMs = SystemClock.elapsedRealtime();
                invalidateState();
                MainActivity.sendMediaActionToJs("seek", this.anchorPosMs);
            }
            return Futures.immediateVoidFuture();
        }

        @NonNull
        @Override
        protected ListenableFuture<?> handleStop() {
            this.anchorPosMs = livePositionSupplier.get();
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playing = false;
            SpotyFlowPlaybackService.isPlaying = false;
            SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
            if (svc != null) {
                svc.updateWakeAndWifiLocks(false);
            }
            invalidateState();
            MainActivity.sendMediaActionToJs("pause", 0L);
            return Futures.immediateVoidFuture();
        }
    }
}
`;

const MAIN_ACTIVITY_JAVA = `package ${APP_ID};

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.BridgeActivity;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

@UnstableApi
public class MainActivity extends BridgeActivity {
    private static final int REQ_SPOTYFLOW_PERMISSIONS = 1001;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);

    private Handler mainHandler;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean bridgeAttached = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        mainHandler = new Handler(Looper.getMainLooper());

        // Buat 4 kategori notifikasi persis Spotify segera saat app dibuka
        SpotyFlowPlaybackService.ensureNotificationChannels(this);

        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            attachMediaBridgeInstance(getBridge().getWebView());
        }

        connectMediaController();
        requestSpotifyLikePermissions();
        requestBatteryOptimizationExemptionOnce();
        handleDeepLinkIntent(getIntent());
    }

    private void connectMediaController() {
        try {
            SessionToken sessionToken = new SessionToken(
                    this,
                    new ComponentName(this, SpotyFlowPlaybackService.class)
            );
            controllerFuture = new MediaController.Builder(this, sessionToken).buildAsync();
        } catch (Exception ignored) {
        }
    }

    public static void attachMediaBridgeToWebView(WebView webView) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act != null && webView != null) {
            act.attachMediaBridgeInstance(webView);
        }
    }

    private void attachMediaBridgeInstance(WebView webView) {
        if (bridgeAttached || webView == null) return;
        bridgeAttached = true;
        try {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            String ua = settings.getUserAgentString();
            if (ua == null) ua = "";
            if (!ua.contains("SpotyFlowApp/")) {
                settings.setUserAgentString(ua + " SpotyFlowApp/5.1");
            }
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.addJavascriptInterface(new SpotyFlowMediaBridgeInterface(), "SpotyFlowMediaBridge");
        } catch (Exception ignored) {
        }
    }

    private void requestSpotifyLikePermissions() {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_AUDIO);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }
        if (!needed.isEmpty()) {
            try {
                ActivityCompat.requestPermissions(
                        this,
                        needed.toArray(new String[0]),
                        REQ_SPOTYFLOW_PERMISSIONS
                );
            } catch (Exception ignored) {
            }
        }
    }

    private void requestBatteryOptimizationExemptionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            SharedPreferences prefs = getSharedPreferences("spotyflow_prefs", Context.MODE_PRIVATE);
            boolean prompted = prefs.getBoolean("sf_battery_prompted", false);
            if (!prompted && pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                prefs.edit().putBoolean("sf_battery_prompted", true).apply();
                Intent batteryIntent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                batteryIntent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(batteryIntent);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
    }

    private void handleDeepLinkIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "spotyflow".equalsIgnoreCase(data.getScheme())) {
            String nonce = data.getQueryParameter("nonce");
            if (nonce != null && !nonce.isEmpty()) {
                dispatchAuthReturnToWebView(nonce);
            }
        }
    }

    public static void sendMediaActionToJs(final String action, final long positionMs) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || action == null) return;
        final String quotedAction = JSONObject.quote(action);
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfOnNativeMediaAction){window.__sfOnNativeMediaAction("
                            + quotedAction + "," + positionMs + ");}}catch(e){}";
                    act.getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public static void dispatchAppVisibilityToWebView(final boolean visible) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null) return;
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfHandleNativeAppVisibility){window.__sfHandleNativeAppVisibility("
                            + (visible ? "true" : "false") + ");}}catch(e){}";
                    act.getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public static void dispatchAuthReturnToWebView(final String nonce) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || nonce == null || nonce.isEmpty()) return;
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfHandleNativeAuthReturn){window.__sfHandleNativeAuthReturn("
                            + JSONObject.quote(nonce) + ");}}catch(e){}";
                    act.getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        activeInstance = new WeakReference<>(this);
        dispatchAppVisibilityToWebView(true);
    }

    @Override
    public void onPause() {
        super.onPause();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onStop() {
        dispatchAppVisibilityToWebView(false);
        super.onStop();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onDestroy() {
        if (controllerFuture != null) {
            try {
                MediaController.releaseFuture(controllerFuture);
            } catch (Exception ignored) {
            }
            controllerFuture = null;
        }
        super.onDestroy();
    }

    private void scheduleBackgroundWebViewKeepAlive() {
        keepBackgroundYouTubeWebViewAlive();
        if (mainHandler != null) {
            mainHandler.postDelayed(this::keepBackgroundYouTubeWebViewAlive, 150L);
            mainHandler.postDelayed(this::keepBackgroundYouTubeWebViewAlive, 500L);
        }
    }

    private void keepBackgroundYouTubeWebViewAlive() {
        try {
            if (SpotyFlowPlaybackService.isPlaying && getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.onResume();
                webView.resumeTimers();
            }
        } catch (Exception ignored) {
        }
    }

    private class SpotyFlowMediaBridgeInterface {
        @JavascriptInterface
        public void updateState(final String jsonPayload) {
            SpotyFlowPlaybackService.dispatchStateUpdate(getApplicationContext(), jsonPayload);
        }

        @JavascriptInterface
        public void stopService() {
            SpotyFlowPlaybackService.requestStopService(getApplicationContext());
        }

        @JavascriptInterface
        public void clearHttpCache() {
            runOnUiThread(() -> {
                try {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().clearCache(true);
                    }
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            if (url == null || (!url.startsWith("https://") && !url.startsWith("http://"))) return;
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {
                }
            });
        }
    }
}
`;

function patchVariablesGradle() {
  if (!fs.existsSync(VARIABLES_GRADLE)) return;
  let content = fs.readFileSync(VARIABLES_GRADLE, 'utf8');
  content = content.replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 34');
  content = content.replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 34');
  content = content.replace(/minSdkVersion\s*=\s*\d+/, (m) => {
    const val = parseInt(m.replace(/\D+/g, ''), 10);
    return val < 24 ? 'minSdkVersion = 24' : m;
  });
  fs.writeFileSync(VARIABLES_GRADLE, content, 'utf8');
  console.log('  + Patched android/variables.gradle (compileSdk=34, targetSdk=34, minSdk>=24)');
}

function patchBuildGradle() {
  if (!fs.existsSync(BUILD_GRADLE)) {
    throw new Error(`Tidak ditemukan ${BUILD_GRADLE}. Pastikan npx cap add android sudah dijalankan.`);
  }
  let content = fs.readFileSync(BUILD_GRADLE, 'utf8');

  // Ensure namespace & applicationId match dynamic APP_ID from capacitor.config.json
  if (/namespace\s+["'][^"']+["']/.test(content)) {
    content = content.replace(/namespace\s+["'][^"']+["']/, `namespace "${APP_ID}"`);
  } else {
    content = content.replace(/android\s*\{/, `android {\n    namespace "${APP_ID}"`);
  }
  if (/applicationId\s+["'][^"']+["']/.test(content)) {
    content = content.replace(/applicationId\s+["'][^"']+["']/, `applicationId "${APP_ID}"`);
  }

  // Ensure Java 17 compileOptions inside android { ... }
  if (!content.includes('JavaVersion.VERSION_17')) {
    if (/compileOptions\s*\{/.test(content)) {
      content = content.replace(
        /compileOptions\s*\{[\s\S]*?\}/,
        `compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }`
      );
    } else {
      content = content.replace(
        /android\s*\{/,
        `android {\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }`
      );
    }
  }

  // Remove unused heavy ExoPlayer dependency if left over from earlier build
  content = content.replace(/^\s*implementation\s+["']androidx\.media3:media3-exoplayer:[^"']+["']\s*$/gm, '');

  // Add lightweight AndroidX Media3 1.4.1 (common + session) + Guava
  const requiredDeps = [
    'implementation "androidx.media3:media3-common:1.4.1"',
    'implementation "androidx.media3:media3-session:1.4.1"',
    'implementation "com.google.guava:guava:32.1.3-android"',
  ];
  const missingDeps = requiredDeps.filter((dep) => {
    const pkgKey = dep.match(/"([^"]+)"/)[1];
    return !content.includes(pkgKey);
  });
  if (missingDeps.length) {
    content = content.replace(
      /dependencies\s*\{/,
      `dependencies {\n    ${missingDeps.join('\n    ')}`
    );
  }

  fs.writeFileSync(BUILD_GRADLE, content, 'utf8');
  console.log(`  + Patched android/app/build.gradle (appId=${APP_ID}, Media3 common+session 1.4.1, Guava, Java 17)`);
}

function patchAndroidManifest() {
  if (!fs.existsSync(MANIFEST_XML)) {
    throw new Error(`Tidak ditemukan ${MANIFEST_XML}.`);
  }
  let xml = fs.readFileSync(MANIFEST_XML, 'utf8');

  // Strip any forbidden overlay permission or legacy SpotyFlowMediaService / MediaButtonReceiver
  xml = xml.replace(/\s*<uses-permission[^>]*SYSTEM_ALERT_WINDOW[^>]*\/>\s*/g, '\n');
  xml = xml.replace(/\s*<service[^>]*android:name="\.SpotyFlowMediaService"[\s\S]*?(<\/service>|\/>)\s*/g, '\n');
  xml = xml.replace(/\s*<receiver[^>]*android:name="androidx\.media\.session\.MediaButtonReceiver"[\s\S]*?(<\/receiver>|\/>)\s*/g, '\n');

  const requiredPermissions = [
    { name: 'android.permission.INTERNET' },
    { name: 'android.permission.ACCESS_NETWORK_STATE' },
    { name: 'android.permission.ACCESS_WIFI_STATE' },
    { name: 'android.permission.WAKE_LOCK' },
    { name: 'android.permission.VIBRATE' },
    { name: 'android.permission.MODIFY_AUDIO_SETTINGS' },
    { name: 'android.permission.FOREGROUND_SERVICE' },
    { name: 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK' },
    { name: 'android.permission.POST_NOTIFICATIONS' },
    { name: 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' },
    { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
    { name: 'android.permission.BLUETOOTH_CONNECT' },
    { name: 'android.permission.READ_MEDIA_AUDIO' },
    { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: '32' },
  ];

  const missingPerms = requiredPermissions.filter((p) => !xml.includes(`android:name="${p.name}"`));
  if (missingPerms.length) {
    const permBlock = missingPerms
      .map((p) =>
        p.maxSdkVersion
          ? `    <uses-permission android:name="${p.name}" android:maxSdkVersion="${p.maxSdkVersion}" />`
          : `    <uses-permission android:name="${p.name}" />`
      )
      .join('\n');
    xml = xml.replace(/<manifest([^>]*)>/, `<manifest$1>\n${permBlock}`);
  }

  // Set android:appCategory="audio", android:largeHeap="true", android:usesCleartextTraffic="true", android:hardwareAccelerated="true" on <application>
  xml = xml.replace(/<application\b([^>]*)>/, (full, attrs) => {
    let nextAttrs = attrs;
    if (!/android:appCategory\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:appCategory="audio"';
    }
    if (!/android:largeHeap\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:largeHeap="true"';
    }
    if (!/android:usesCleartextTraffic\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:usesCleartextTraffic="true"';
    }
    if (!/android:hardwareAccelerated\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:hardwareAccelerated="true"';
    }
    return `<application${nextAttrs}>`;
  });

  // Ensure android:hardwareAccelerated="true" on <activity> (MainActivity) for 60-120fps WebView GPU rendering
  xml = xml.replace(/<activity\b([^>]*)>/, (full, attrs) => {
    if (/android:hardwareAccelerated\s*=/.test(attrs)) return full;
    return `<activity${attrs}\n            android:hardwareAccelerated="true">`;
  });

  // Register spotyflow:// deep link on MainActivity (Chrome Google Auth handoff)
  if (!xml.includes('android:scheme="spotyflow"')) {
    const deepLinkFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="spotyflow" />
            </intent-filter>
        `;
    if (xml.includes('</activity>')) {
      xml = xml.replace('</activity>', `${deepLinkFilter}</activity>`);
    }
  }

  // Register SpotyFlowPlaybackService (Media3 MediaSessionService) + Media3 MediaButtonReceiver
  if (!xml.includes('android:name=".SpotyFlowPlaybackService"')) {
    const serviceBlock = `
        <service
            android:name=".SpotyFlowPlaybackService"
            android:enabled="true"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="androidx.media3.session.MediaSessionService" />
                <action android:name="android.media.browse.MediaBrowserService" />
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </service>

        <receiver
            android:name="androidx.media3.session.MediaButtonReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </receiver>
    `;
    xml = xml.replace('</application>', `${serviceBlock}\n    </application>`);
  }

  fs.writeFileSync(MANIFEST_XML, xml, 'utf8');
  console.log('  + Patched AndroidManifest.xml (14 Spotify permissions, appCategory=audio, Media3 MediaSessionService & MediaButtonReceiver)');
}

function writeJavaAndResSources() {
  // Remove stale legacy com/spotyflow/music Java folder so javac never hits duplicate class errors
  if (APP_ID !== 'com.spotyflow.music') {
    const legacyDir = path.join(JAVA_ROOT_DIR, 'com', 'spotyflow', 'music');
    if (fs.existsSync(legacyDir)) {
      fs.rmSync(legacyDir, { recursive: true, force: true });
      console.log('  + Removed legacy duplicate Java folder: com/spotyflow/music');
    }
    const legacyParent = path.join(JAVA_ROOT_DIR, 'com', 'spotyflow');
    if (fs.existsSync(legacyParent) && fs.readdirSync(legacyParent).length === 0) {
      fs.rmSync(legacyParent, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(JAVA_PKG_DIR, { recursive: true });
  fs.mkdirSync(RES_LAYOUT_DIR, { recursive: true });
  fs.mkdirSync(RES_DRAWABLE_DIR, { recursive: true });

  // Clean up any legacy ExoPlayer / resolver / service Java files
  for (const legacy of ['NativeYouTubeResolver.java', 'SpotyFlowMediaService.java', 'SpotyFlowMediaPlugin.java']) {
    const p = path.join(JAVA_PKG_DIR, legacy);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      console.log('  + Removed legacy Java file:', legacy);
    }
  }

  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), SPOTYFLOW_WEBVIEW_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), SPOTYFLOW_PLAYBACK_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), MAIN_ACTIVITY_JAVA, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'), IC_STAT_MUSIC_XML, 'utf8');

  console.log(`  + Written 3 Java classes to ${path.relative(ROOT, JAVA_PKG_DIR)} (package ${APP_ID}) + layout & vector icon`);
}

function verifyPatchedProject() {
  const mustExist = [
    BUILD_GRADLE,
    MANIFEST_XML,
    path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'),
    path.join(JAVA_PKG_DIR, 'MainActivity.java'),
    path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'),
  ];
  for (const f of mustExist) {
    if (!fs.existsSync(f)) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED — file tidak ditemukan:', f);
      process.exit(1);
    }
  }

  if (fs.existsSync(path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'))) {
    console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED — NativeYouTubeResolver.java lama masih ada!');
    process.exit(1);
  }
  if (APP_ID !== 'com.spotyflow.music') {
    const legacyDir = path.join(JAVA_ROOT_DIR, 'com', 'spotyflow', 'music');
    if (fs.existsSync(legacyDir)) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED — folder Java lama com/spotyflow/music masih ada!');
      process.exit(1);
    }
  }

  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const manifest = fs.readFileSync(MANIFEST_XML, 'utf8');
  const svc = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), 'utf8');
  const act = fs.readFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), 'utf8');
  const webv = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), 'utf8');
  const layout = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), 'utf8');

  const pkgDecl = `package ${APP_ID};`;
  const checks = [
    [gradle.includes(`namespace "${APP_ID}"`), `build.gradle missing namespace "${APP_ID}"`],
    [gradle.includes(`applicationId "${APP_ID}"`), `build.gradle missing applicationId "${APP_ID}"`],
    [gradle.includes('androidx.media3:media3-common:1.4.1'), 'build.gradle missing media3-common:1.4.1'],
    [gradle.includes('androidx.media3:media3-session:1.4.1'), 'build.gradle missing media3-session:1.4.1'],
    [!gradle.includes('media3-exoplayer'), 'build.gradle should NOT include heavy media3-exoplayer'],
    [gradle.includes('com.google.guava:guava:32.1.3-android'), 'build.gradle missing guava'],
    [gradle.includes('JavaVersion.VERSION_17'), 'build.gradle missing Java 17'],
    [svc.startsWith(pkgDecl) && act.startsWith(pkgDecl) && webv.startsWith(pkgDecl), `Java files missing ${pkgDecl}`],
    [layout.includes(`<${APP_ID}.SpotyFlowWebView`), `bridge_layout_main.xml missing <${APP_ID}.SpotyFlowWebView`],
    [webv.includes('onWindowVisibilityChanged') && webv.includes('SpotyFlowPlaybackService.isPlaying'), 'SpotyFlowWebView missing background visibility override'],
    [manifest.includes('android:appCategory="audio"'), 'Manifest missing appCategory="audio"'],
    [manifest.includes('androidx.media3.session.MediaSessionService'), 'Manifest missing MediaSessionService'],
    [manifest.includes('androidx.media3.session.MediaButtonReceiver'), 'Manifest missing Media3 MediaButtonReceiver'],
    [!manifest.includes('SpotyFlowMediaService'), 'Manifest still has legacy SpotyFlowMediaService'],
    [!manifest.includes('SYSTEM_ALERT_WINDOW'), 'Manifest must NOT contain SYSTEM_ALERT_WINDOW'],
    [svc.includes('extends MediaSessionService') && svc.includes('extends SimpleBasePlayer') && svc.includes('@UnstableApi'), 'Service must use SimpleBasePlayer + MediaSessionService + @UnstableApi'],
    [svc.includes('ForwardingPlayer') && svc.includes('hasNextMediaItem') && svc.includes('hasPreviousMediaItem'), 'Service missing ForwardingPlayer Next/Prev overrides'],
    [svc.includes('spotyflow_general') && svc.includes('spotyflow_playback') && svc.includes('spotyflow_music') && svc.includes('spotyflow_downloads'), 'Service missing 4 notification channels'],
    [svc.includes('PARTIAL_WAKE_LOCK') && svc.includes('ACTION_AUDIO_BECOMING_NOISY'), 'Service missing WakeLock or Noisy receiver'],
    [act.includes('"SpotyFlowMediaBridge"') && act.includes('sendMediaActionToJs') && act.includes('setMediaPlaybackRequiresUserGesture(false)') && act.includes('setDomStorageEnabled(true)'), 'MainActivity missing SpotyFlowMediaBridge or WebView settings'],
    [act.includes('View.LAYER_TYPE_HARDWARE') && act.includes('View.SCROLLBARS_INSIDE_OVERLAY') && act.includes('View.OVER_SCROLL_NEVER'), 'MainActivity missing GPU hardware acceleration WebView flags'],
    [(manifest.match(/android:hardwareAccelerated="true"/g) || []).length >= 2, 'Manifest missing android:hardwareAccelerated="true" on <application> and <activity>'],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED:', msg);
      process.exit(1);
    }
  }
  console.log(`  + Strict self-verification passed (${checks.length}/${checks.length} Media3 SimpleBasePlayer + Origin Island + Background YouTube checks)`);
}

function main() {
  try {
    if (!fs.existsSync(ANDROID_DIR)) {
      throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
    }
    console.log(`[SpotyFlow Media3 Patcher] Injecting Media3 SimpleBasePlayer + Background YouTube WebView (appId=${APP_ID})...`);
    patchVariablesGradle();
    patchBuildGradle();
    patchAndroidManifest();
    writeJavaAndResSources();
    verifyPatchedProject();
    console.log('[SpotyFlow Media3 Patcher] SELESAI — siap kompilasi Gradle 8 / Java 17!');
  } catch (err) {
    console.error('[SpotyFlow Media3 Patcher] ERROR:', err?.message || err);
    process.exit(1);
  }
}

main();
