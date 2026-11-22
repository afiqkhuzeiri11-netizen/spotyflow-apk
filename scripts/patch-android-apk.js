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
    public void onPause() {
        // JANGAN pause WebView saat lagu sedang diputar agar TIDAK ada jeda sesaat saat keluar APK / layar mati!
        if (SpotyFlowPlaybackService.isPlaying) {
            return;
        }
        super.onPause();
    }

    @Override
    public void pauseTimers() {
        // JANGAN hentikan timer JS/YouTube saat lagu berjalan di latar belakang!
        if (SpotyFlowPlaybackService.isPlaying) {
            return;
        }
        super.pauseTimers();
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
    public void dispatchWindowVisibilityChanged(int visibility) {
        if (visibility != View.VISIBLE && SpotyFlowPlaybackService.isPlaying) {
            super.dispatchWindowVisibilityChanged(View.VISIBLE);
            return;
        }
        super.dispatchWindowVisibilityChanged(visibility);
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        if (changedView == this && visibility != View.VISIBLE && SpotyFlowPlaybackService.isPlaying) {
            super.onVisibilityChanged(changedView, View.VISIBLE);
            return;
        }
        super.onVisibilityChanged(changedView, visibility);
    }
}
`;

const BRIDGE_LAYOUT_MAIN_XML = `<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#050505"
    tools:context="com.getcapacitor.BridgeActivity">

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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class SpotyFlowPlaybackService extends MediaSessionService {
    public static final String CHANNEL_GENERAL = "spotyflow_general";
    public static final String CHANNEL_PLAYBACK = "spotyflow_playback";
    public static final String CHANNEL_MUSIC = "spotyflow_music";
    public static final String CHANNEL_DOWNLOADS = "spotyflow_downloads";

    public static volatile SpotyFlowPlaybackService instance = null;
    public static volatile boolean isPlaying = false;
    private static volatile String pendingJsonPayload = null;
    private volatile boolean serviceStarted = false;

    private Handler mainHandler;
    private ExecutorService artworkExecutor;
    private SpotyFlowRemotePlayer remotePlayer;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean noisyReceiverRegistered = false;

    // Diff-check state (anti redundant invalidateState() & zero UI overhead)
    private boolean hasAppliedState = false;
    private String lastTrackId = "";
    private String lastTitle = "";
    private String lastArtist = "";
    private String lastAlbum = "";
    private String lastCoverUrl = "";
    private boolean lastPlaying = false;
    private long lastDurationMs = 0L;
    private float lastPlaybackRate = 1.0f;

    // In-memory 256x256 JPEG artwork cache (anti re-download)
    private String cachedCoverUrl = "";
    private byte[] cachedArtworkBytes = null;
    private String fetchingCoverUrl = "";

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
        // Update flag isPlaying SEKETIKA sebelum mainHandler.post agar SpotyFlowWebView langsung melindungi audio walau Home/Power ditekan 50ms setelah Play!
        boolean playingQuick = false;
        boolean hasPlayingField = false;
        try {
            JSONObject quickObj = new JSONObject(jsonPayload);
            if (quickObj.has("isPlaying")) {
                hasPlayingField = true;
                playingQuick = quickObj.optBoolean("isPlaying", SpotyFlowPlaybackService.isPlaying);
                SpotyFlowPlaybackService.isPlaying = playingQuick;
            }
        } catch (Throwable ignored) {
        }
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            // Pastikan service benar-benar STARTED Foreground Service (bukan hanya bound oleh MediaController)
            // saat musik mulai diputar di foreground agar Android 15/16 tidak pernah membekukan proses saat tombol Home ditekan!
            if (hasPlayingField && playingQuick && !svc.serviceStarted && ctx != null && MainActivity.isActivityInForeground) {
                try {
                    ContextCompat.startForegroundService(ctx, new Intent(ctx, SpotyFlowPlaybackService.class));
                } catch (Throwable ignored) {
                }
            }
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
                svc.serviceStarted = false;
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
        artworkExecutor = Executors.newSingleThreadExecutor();

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
        serviceStarted = true;
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
        serviceStarted = false;
        isPlaying = false;
        updateWakeAndWifiLocks(false);
        unregisterBecomingNoisyReceiver();
        if (artworkExecutor != null) {
            artworkExecutor.shutdownNow();
            artworkExecutor = null;
        }
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
                    wakeLock.acquire();
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

            // Diff-check ketat: jika metadata, playing, durationMs, playbackRate SAMA dan posisi < 2.5s drift, SKIP invalidateState()!
            long estPos = remotePlayer.getEstimatedPositionMs();
            boolean sameMeta = hasAppliedState
                    && trackId.equals(lastTrackId)
                    && title.equals(lastTitle)
                    && artist.equals(lastArtist)
                    && album.equals(lastAlbum)
                    && coverUrl.equals(lastCoverUrl)
                    && playingNow == lastPlaying
                    && durationMs == lastDurationMs
                    && Math.abs(playbackRate - lastPlaybackRate) < 0.01f;
            if (sameMeta && Math.abs(positionMs - estPos) < 2500L) {
                return;
            }

            boolean wasPlaying = isPlaying;
            hasAppliedState = true;
            lastTrackId = trackId;
            lastTitle = title;
            lastArtist = artist;
            lastAlbum = album;
            lastCoverUrl = coverUrl;
            lastPlaying = playingNow;
            lastDurationMs = durationMs;
            lastPlaybackRate = playbackRate;

            isPlaying = playingNow;
            updateWakeAndWifiLocks(playingNow);

            byte[] artForCover = coverUrl.equals(cachedCoverUrl) ? cachedArtworkBytes : null;
            remotePlayer.updateFromJs(
                    trackId, title, artist, album, coverUrl, artForCover,
                    playingNow, durationMs, positionMs, playbackRate
            );

            if (!coverUrl.equals(cachedCoverUrl) && !coverUrl.equals(fetchingCoverUrl)) {
                fetchAndCacheCoverAsync(coverUrl);
            }

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
     * Downloads cover artwork ONCE per URL on background thread, resizes to max 256x256 JPEG (~15 KB),
     * caches in RAM, and triggers a single invalidateState() so Dynamic Island stays sharp with 0% UI lag.
     */
    private void fetchAndCacheCoverAsync(final String urlStr) {
        if (urlStr == null || !urlStr.startsWith("http")) return;
        if (artworkExecutor == null || artworkExecutor.isShutdown()) return;
        fetchingCoverUrl = urlStr;

        artworkExecutor.execute(() -> {
            HttpURLConnection conn = null;
            byte[] jpegBytes = null;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "SpotyFlow-Android/12.2");
                if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    byte[] raw;
                    try (InputStream is = conn.getInputStream();
                         ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        int total = 0;
                        while ((n = is.read(buf)) != -1) {
                            total += n;
                            if (total > 2000000) break;
                            bos.write(buf, 0, n);
                        }
                        raw = bos.toByteArray();
                    }
                    if (raw.length > 64) {
                        Bitmap decoded = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                        if (decoded != null) {
                            int w = decoded.getWidth();
                            int h = decoded.getHeight();
                            Bitmap target = decoded;
                            if (w > 256 || h > 256) {
                                float scale = Math.min(256f / Math.max(1, w), 256f / Math.max(1, h));
                                int nw = Math.max(1, Math.round(w * scale));
                                int nh = Math.max(1, Math.round(h * scale));
                                target = Bitmap.createScaledBitmap(decoded, nw, nh, true);
                                if (target != decoded) {
                                    decoded.recycle();
                                }
                            }
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            target.compress(Bitmap.CompressFormat.JPEG, 82, out);
                            target.recycle();
                            jpegBytes = out.toByteArray();
                        }
                    }
                }
            } catch (Throwable ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }

            final byte[] finalBytes = jpegBytes;
            if (mainHandler != null) {
                mainHandler.post(() -> {
                    if (urlStr.equals(fetchingCoverUrl)) {
                        fetchingCoverUrl = "";
                    }
                    if (finalBytes != null && finalBytes.length > 64) {
                        cachedCoverUrl = urlStr;
                        cachedArtworkBytes = finalBytes;
                        if (remotePlayer != null && urlStr.equals(lastCoverUrl)) {
                            remotePlayer.updateArtworkBytes(finalBytes);
                            if (mediaSession != null && isPlaying) {
                                try {
                                    onUpdateNotification(mediaSession, true);
                                } catch (Throwable ignored) {
                                }
                            }
                        }
                    }
                });
            }
        });
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
        private byte[] artworkBytes = null;
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

        long getEstimatedPositionMs() {
            return livePositionSupplier.get();
        }

        void updateFromJs(
                String trackId, String title, String artist, String album, String coverUrl, byte[] artworkBytes,
                boolean playing, long durationMs, long positionMs, float playbackRate
        ) {
            this.hasTrack = true;
            this.trackId = trackId;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.coverUrl = coverUrl;
            this.artworkBytes = artworkBytes;
            this.playing = playing;
            this.durationMs = durationMs;
            this.anchorPosMs = positionMs;
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playbackRate = playbackRate;
            invalidateState();
        }

        void updateArtworkBytes(byte[] bytes) {
            this.artworkBytes = bytes;
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
                MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(artist)
                        .setAlbumTitle(album)
                        .setDisplayTitle(title)
                        .setSubtitle(artist)
                        .setArtworkUri(Uri.parse(safeCover));
                if (artworkBytes != null && artworkBytes.length > 0) {
                    metaBuilder.setArtworkData(artworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER);
                }
                MediaMetadata metadata = metaBuilder.build();

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
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
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

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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
    public static volatile boolean isActivityInForeground = false;

    private Handler mainHandler;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean bridgeAttached = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        isActivityInForeground = true;
        mainHandler = new Handler(Looper.getMainLooper());

        // Buat 4 kategori notifikasi persis Spotify segera saat app dibuka
        SpotyFlowPlaybackService.ensureNotificationChannels(this);

        super.onCreate(savedInstanceState);

        // Pastikan area status bar & gesture bar Android 15/16 (edge-to-edge) selalu gelap pekat #050505 dengan ikon putih tajam
        try {
            getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor("#050505")));
            WindowInsetsControllerCompat insetsController =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (insetsController != null) {
                insetsController.setAppearanceLightStatusBars(false);
                insetsController.setAppearanceLightNavigationBars(false);
            }
        } catch (Throwable ignored) {
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            attachMediaBridgeInstance(getBridge().getWebView());
        }

        // Tombol Back di halaman root meminimalkan aplikasi saat lagu berputar (seperti Spotify), BUKAN mematikan lagu!
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                    return;
                }
                if (SpotyFlowPlaybackService.isPlaying) {
                    moveTaskToBack(true);
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

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
                settings.setUserAgentString(ua + " SpotyFlowApp/5.3");
            }
            // Kunci prioritas renderer WebView tetap IMPORTANT agar OS tidak mencekik CPU audio saat keluar APK / layar mati
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
            // Biarkan default View.LAYER_TYPE_NONE agar Chromium memakai native hardware compositor tanpa double FBO
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

    public static void dispatchAppBackgroundedToWebView(final boolean isBg) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null) return;
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfSetAppBackgrounded){window.__sfSetAppBackgrounded("
                            + (isBg ? "true" : "false") + ");}}catch(e){}";
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
        isActivityInForeground = true;
        dispatchAppBackgroundedToWebView(false);
        dispatchAppVisibilityToWebView(true);
    }

    @Override
    public void onPause() {
        isActivityInForeground = false;
        // Segera istirahatkan animasi visual berat sebelum transisi keluar APK agar animasi sistem mulus tanpa merebut CPU dari audio!
        dispatchAppBackgroundedToWebView(true);
        super.onPause();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onStop() {
        dispatchAppBackgroundedToWebView(true);
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
  content = content.replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 35');
  content = content.replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 35');
  content = content.replace(/minSdkVersion\s*=\s*\d+/, (m) => {
    const val = parseInt(m.replace(/\D+/g, ''), 10);
    return val < 23 ? 'minSdkVersion = 23' : m;
  });
  fs.writeFileSync(VARIABLES_GRADLE, content, 'utf8');
  console.log('  + Patched android/variables.gradle (compileSdk=35, targetSdk=35, minSdk>=23)');
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

  // Ensure Java 21 compileOptions inside android { ... } (required by Capacitor 7 + SDK 35)
  if (!content.includes('JavaVersion.VERSION_21')) {
    if (/compileOptions\s*\{/.test(content)) {
      content = content.replace(
        /compileOptions\s*\{[\s\S]*?\}/,
        `compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }`
      );
    } else {
      content = content.replace(
        /android\s*\{/,
        `android {\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }`
      );
    }
  }

  // Production Release BuildType (full Android ART speed, non-debuggable, zero R8/ProGuard breakage, installable with debug keystore)
  const releaseBlock = `release {\n            minifyEnabled false\n            shrinkResources false\n            signingConfig signingConfigs.debug\n        }`;
  if (/buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?\}/.test(content)) {
    content = content.replace(/release\s*\{[\s\S]*?\}/, releaseBlock);
  } else if (/buildTypes\s*\{/.test(content)) {
    content = content.replace(/buildTypes\s*\{/, `buildTypes {\n        ${releaseBlock}`);
  } else {
    content = content.replace(/android\s*\{/, `android {\n    buildTypes {\n        ${releaseBlock}\n    }`);
  }

  // Remove unused heavy ExoPlayer or old Media3 1.4.x dependencies if present
  content = content.replace(/^\s*implementation\s+["']androidx\.media3:media3-(?:exoplayer|common|session):1\.4\.[^"']*["']\s*$/gm, '');
  content = content.replace(/^\s*implementation\s+["']androidx\.media3:media3-exoplayer:[^"']+["']\s*$/gm, '');

  // Add lightweight AndroidX Media3 1.5.1 (common + session) + Guava for SDK 35
  const requiredDeps = [
    'implementation "androidx.media3:media3-common:1.5.1"',
    'implementation "androidx.media3:media3-session:1.5.1"',
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
  console.log(`  + Patched android/app/build.gradle (appId=${APP_ID}, Media3 1.5.1, Guava, Java 21, Production release buildType)`);
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

  // Ensure launchMode="singleTask", configChanges, and hardwareAccelerated="true" on <activity> (MainActivity)
  const requiredConfigChanges = 'orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation';
  xml = xml.replace(/<activity\b([^>]*)>/, (full, attrs) => {
    let nextAttrs = attrs;
    if (/android:launchMode\s*=\s*"[^"]*"/.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(/android:launchMode\s*=\s*"[^"]*"/, 'android:launchMode="singleTask"');
    } else {
      nextAttrs += '\n            android:launchMode="singleTask"';
    }
    if (/android:configChanges\s*=\s*"[^"]*"/.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(/android:configChanges\s*=\s*"[^"]*"/, `android:configChanges="${requiredConfigChanges}"`);
    } else {
      nextAttrs += `\n            android:configChanges="${requiredConfigChanges}"`;
    }
    if (!/android:hardwareAccelerated\s*=/.test(nextAttrs)) {
      nextAttrs += '\n            android:hardwareAccelerated="true"';
    }
    return `<activity${nextAttrs}>`;
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
  // KRUSIAL CAPACITOR 7: BridgeActivity.java memakai R.layout.capacitor_bridge_layout_main (bukan hanya bridge_layout_main)!
  // Tulis KEDUANYA agar SpotyFlowWebView 100% ter-inflate pada Capacitor 7 maupun kompatibilitas mundur.
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'), IC_STAT_MUSIC_XML, 'utf8');

  console.log(`  + Written 3 Java classes to ${path.relative(ROOT, JAVA_PKG_DIR)} (package ${APP_ID}) + capacitor_bridge_layout_main.xml & bridge_layout_main.xml + vector icon`);
}

function verifyPatchedProject() {
  const mustExist = [
    BUILD_GRADLE,
    MANIFEST_XML,
    path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'),
    path.join(JAVA_PKG_DIR, 'MainActivity.java'),
    path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'),
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

  const variablesGradle = fs.existsSync(VARIABLES_GRADLE) ? fs.readFileSync(VARIABLES_GRADLE, 'utf8') : '';
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const manifest = fs.readFileSync(MANIFEST_XML, 'utf8');
  const svc = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), 'utf8');
  const act = fs.readFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), 'utf8');
  const webv = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), 'utf8');
  const capLayout = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'), 'utf8');
  const layout = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), 'utf8');

  const pkgDecl = `package ${APP_ID};`;
  const checks = [
    [!variablesGradle || (variablesGradle.includes('compileSdkVersion = 35') && variablesGradle.includes('targetSdkVersion = 35')), 'variables.gradle missing compileSdk/targetSdk = 35'],
    [gradle.includes(`namespace "${APP_ID}"`), `build.gradle missing namespace "${APP_ID}"`],
    [gradle.includes(`applicationId "${APP_ID}"`), `build.gradle missing applicationId "${APP_ID}"`],
    [gradle.includes('androidx.media3:media3-common:1.5.1'), 'build.gradle missing media3-common:1.5.1'],
    [gradle.includes('androidx.media3:media3-session:1.5.1'), 'build.gradle missing media3-session:1.5.1'],
    [!gradle.includes('media3-exoplayer'), 'build.gradle should NOT include heavy media3-exoplayer'],
    [gradle.includes('com.google.guava:guava:32.1.3-android'), 'build.gradle missing guava'],
    [gradle.includes('JavaVersion.VERSION_21'), 'build.gradle missing Java 21'],
    [gradle.includes('minifyEnabled false') && gradle.includes('shrinkResources false') && gradle.includes('signingConfig signingConfigs.debug'), 'build.gradle missing production release buildType config'],
    [svc.startsWith(pkgDecl) && act.startsWith(pkgDecl) && webv.startsWith(pkgDecl), `Java files missing ${pkgDecl}`],
    [capLayout.includes(`<${APP_ID}.SpotyFlowWebView`), `capacitor_bridge_layout_main.xml missing <${APP_ID}.SpotyFlowWebView`],
    [layout.includes(`<${APP_ID}.SpotyFlowWebView`), `bridge_layout_main.xml missing <${APP_ID}.SpotyFlowWebView`],
    [svc.includes('serviceStarted') && act.includes('isActivityInForeground'), 'Service/MainActivity missing Android 15 foreground service promotion guard'],
    [webv.includes('onWindowVisibilityChanged') && webv.includes('dispatchWindowVisibilityChanged') && webv.includes('onVisibilityChanged') && webv.includes('SpotyFlowPlaybackService.isPlaying'), 'SpotyFlowWebView missing full background visibility & pause overrides'],
    [manifest.includes('android:appCategory="audio"'), 'Manifest missing appCategory="audio"'],
    [manifest.includes('android:launchMode="singleTask"'), 'Manifest missing launchMode="singleTask" on MainActivity'],
    [manifest.includes('android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"'), 'Manifest missing full configChanges (including navigation) on MainActivity'],
    [manifest.includes('androidx.media3.session.MediaSessionService'), 'Manifest missing MediaSessionService'],
    [manifest.includes('androidx.media3.session.MediaButtonReceiver'), 'Manifest missing Media3 MediaButtonReceiver'],
    [!manifest.includes('SpotyFlowMediaService'), 'Manifest still has legacy SpotyFlowMediaService'],
    [!manifest.includes('SYSTEM_ALERT_WINDOW'), 'Manifest must NOT contain SYSTEM_ALERT_WINDOW'],
    [svc.includes('extends MediaSessionService') && svc.includes('extends SimpleBasePlayer') && svc.includes('@UnstableApi'), 'Service must use SimpleBasePlayer + MediaSessionService + @UnstableApi'],
    [svc.includes('ForwardingPlayer') && svc.includes('hasNextMediaItem') && svc.includes('hasPreviousMediaItem'), 'Service missing ForwardingPlayer Next/Prev overrides'],
    [svc.includes('spotyflow_general') && svc.includes('spotyflow_playback') && svc.includes('spotyflow_music') && svc.includes('spotyflow_downloads'), 'Service missing 4 notification channels'],
    [svc.includes('PARTIAL_WAKE_LOCK') && svc.includes('wakeLock.acquire()') && svc.includes('ACTION_AUDIO_BECOMING_NOISY'), 'Service missing indefinite WakeLock or Noisy receiver'],
    [act.includes('"SpotyFlowMediaBridge"') && act.includes('sendMediaActionToJs') && act.includes('setMediaPlaybackRequiresUserGesture(false)') && act.includes('setDomStorageEnabled(true)'), 'MainActivity missing SpotyFlowMediaBridge or WebView settings'],
    [act.includes('RENDERER_PRIORITY_IMPORTANT') && act.includes('moveTaskToBack(true)') && act.includes('__sfSetAppBackgrounded'), 'MainActivity missing renderer priority, moveTaskToBack, or __sfSetAppBackgrounded'],
    [!act.includes('LAYER_TYPE_HARDWARE'), 'MainActivity must NOT force LAYER_TYPE_HARDWARE (causes GPU double-compositing lag!)'],
    [act.includes('View.SCROLLBARS_INSIDE_OVERLAY') && act.includes('View.OVER_SCROLL_NEVER'), 'MainActivity missing WebView scroll/overscroll flags'],
    [svc.includes('cachedArtworkBytes') && svc.includes('createScaledBitmap') && svc.includes('Math.abs(positionMs - estPos) < 2500L'), 'Service missing diff-check debounce or 256x256 artwork cache'],
    [(manifest.match(/android:hardwareAccelerated="true"/g) || []).length >= 2, 'Manifest missing android:hardwareAccelerated="true" on <application> and <activity>'],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED:', msg);
      process.exit(1);
    }
  }
  console.log(`  + Strict self-verification passed (${checks.length}/${checks.length} Capacitor 7 + SDK 35 + Media3 1.5.1 + Origin Island checks)`);
}

function main() {
  try {
    if (!fs.existsSync(ANDROID_DIR)) {
      throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
    }
    console.log(`[SpotyFlow Media3 Patcher] Injecting Capacitor 7 + SDK 35 + Media3 1.5.1 (appId=${APP_ID})...`);
    patchVariablesGradle();
    patchBuildGradle();
    patchAndroidManifest();
    writeJavaAndResSources();
    verifyPatchedProject();
    console.log('[SpotyFlow Media3 Patcher] SELESAI — siap kompilasi Gradle / Java 21 Release!');
  } catch (err) {
    console.error('[SpotyFlow Media3 Patcher] ERROR:', err?.message || err);
    process.exit(1);
  }
}

main();
