'use strict';
/**
 * SpotyFlow Native Android Patcher (scripts/patch-android-apk.js)
 * Runs after `npx cap sync android` to inject official Spotify-style:
 *  - androidx.media:media:1.7.0 + noCompress ["wav", "wasm"] in android/app/build.gradle
 *  - Clean permissions (NO SYSTEM_ALERT_WINDOW / NO fake overlays!) & mediaPlayback service in AndroidManifest.xml
 *  - SpotyFlowMediaService.java (MediaSessionCompat + MediaStyle Foreground Service + AudioFocus + Noisy + Wake/WifiLock)
 *  - SpotyFlowMediaPlugin.java  (@CapacitorPlugin("SpotyFlowMedia"))
 *  - MainActivity.java          (registerPlugin + POST_NOTIFICATIONS + background WebView resume keep-alive)
 * 100% compatible with Android 8 – Android 15+ (API 26–35) and Capacitor 6 / Java 17.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const APP_DIR = path.join(ANDROID_DIR, 'app');
const BUILD_GRADLE = path.join(APP_DIR, 'build.gradle');
const MANIFEST_XML = path.join(APP_DIR, 'src', 'main', 'AndroidManifest.xml');
const JAVA_PKG_DIR = path.join(APP_DIR, 'src', 'main', 'java', 'com', 'spotyflow', 'music');
const RES_LAYOUT_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'layout');

const SPOTYFLOW_MEDIA_SERVICE_JAVA = `package com.spotyflow.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SpotyFlowMediaService extends Service {
    public static final String CHANNEL_ID = "spotyflow_playback_channel_v2";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_UPDATE = "com.spotyflow.music.ACTION_UPDATE";
    public static final String ACTION_PLAY_PAUSE = "com.spotyflow.music.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.spotyflow.music.ACTION_NEXT";
    public static final String ACTION_PREV = "com.spotyflow.music.ACTION_PREV";
    public static final String ACTION_STOP = "com.spotyflow.music.ACTION_STOP";

    public static volatile boolean isPlaying = false;

    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private ExecutorService artworkExecutor;
    private Handler mainHandler;

    private String currentTitle = "SpotyFlow";
    private String currentArtist = "SpotyFlow Studio";
    private String currentAlbum = "SpotyFlow";
    private String currentCoverUrl = "";
    private long currentDurationMs = 0L;
    private long currentPositionMs = 0L;
    private float currentPlaybackRate = 1.0f;

    private String lastLoadedCoverUrl = "";
    private Bitmap cachedCoverBitmap = null;
    private Bitmap fallbackArtworkCache = null;
    private boolean noisyReceiverRegistered = false;
    private boolean isInForeground = false;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                isPlaying = false;
                releasePowerLocks();
                SpotyFlowMediaPlugin.emitMediaAction("noisy", -1L);
                updatePlaybackStateAndNotification();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        artworkExecutor = Executors.newSingleThreadExecutor();

        createNotificationChannel();
        initMediaSession();
        registerNoisyReceiverSafe();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "SpotyFlow Music Player",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Kontrol pemutaran musik latar belakang & Dynamic Island SpotyFlow");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "SpotyFlowMediaSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                SpotyFlowMediaPlugin.emitMediaAction("play", -1L);
            }

            @Override
            public void onPause() {
                SpotyFlowMediaPlugin.emitMediaAction("pause", -1L);
            }

            @Override
            public void onSkipToNext() {
                SpotyFlowMediaPlugin.emitMediaAction("next", -1L);
            }

            @Override
            public void onSkipToPrevious() {
                SpotyFlowMediaPlugin.emitMediaAction("prev", -1L);
            }

            @Override
            public void onSeekTo(long pos) {
                currentPositionMs = Math.max(0L, pos);
                SpotyFlowMediaPlugin.emitMediaAction("seek", currentPositionMs);
                updatePlaybackStateAndNotification();
            }

            @Override
            public void onStop() {
                isPlaying = false;
                releasePowerLocks();
                SpotyFlowMediaPlugin.emitMediaAction("pause", -1L);
                stopSelf();
            }
        });
        mediaSession.setActive(true);
    }

    private void registerNoisyReceiverSafe() {
        if (noisyReceiverRegistered) return;
        try {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(noisyReceiver, filter);
            }
            noisyReceiverRegistered = true;
        } catch (Exception ignored) {
        }
    }

    private void acquirePowerLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SpotyFlow:AudioWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            }
        } catch (Exception ignored) {
        }

        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                            : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "SpotyFlow:AudioWifiLock");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void releasePowerLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_PLAY_PAUSE.equals(action)) {
            SpotyFlowMediaPlugin.emitMediaAction(isPlaying ? "pause" : "play", -1L);
            return START_STICKY;
        } else if (ACTION_NEXT.equals(action)) {
            SpotyFlowMediaPlugin.emitMediaAction("next", -1L);
            return START_STICKY;
        } else if (ACTION_PREV.equals(action)) {
            SpotyFlowMediaPlugin.emitMediaAction("prev", -1L);
            return START_STICKY;
        } else if (ACTION_STOP.equals(action)) {
            isPlaying = false;
            releasePowerLocks();
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        String album = intent.getStringExtra("album");
        String coverUrl = intent.getStringExtra("coverUrl");
        boolean playing = intent.getBooleanExtra("isPlaying", false);
        long durationMs = intent.getLongExtra("durationMs", 0L);
        long positionMs = intent.getLongExtra("positionMs", 0L);
        float playbackRate = intent.getFloatExtra("playbackRate", 1.0f);

        if (title != null && !title.isEmpty()) currentTitle = title;
        if (artist != null && !artist.isEmpty()) currentArtist = artist;
        if (album != null && !album.isEmpty()) currentAlbum = album;
        currentCoverUrl = coverUrl != null ? coverUrl : "";
        currentDurationMs = Math.max(0L, durationMs);
        currentPositionMs = Math.max(0L, positionMs);
        currentPlaybackRate = playbackRate > 0f ? playbackRate : 1.0f;
        isPlaying = playing;

        if (isPlaying) {
            acquirePowerLocks();
        } else {
            releasePowerLocks();
        }

        updatePlaybackStateAndNotification();
        loadCoverArtworkAsync(currentCoverUrl);
        return START_STICKY;
    }

    private Bitmap getFallbackArtwork() {
        if (fallbackArtworkCache != null && !fallbackArtworkCache.isRecycled()) {
            return fallbackArtworkCache;
        }
        try {
            fallbackArtworkCache = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
            return fallbackArtworkCache;
        } catch (Exception e) {
            return null;
        }
    }

    private void loadCoverArtworkAsync(final String urlStr) {
        if (urlStr == null || urlStr.isEmpty() || !urlStr.startsWith("http")) {
            return;
        }
        if (urlStr.equals(lastLoadedCoverUrl) && cachedCoverBitmap != null) {
            return;
        }
        if (artworkExecutor == null || artworkExecutor.isShutdown()) return;

        artworkExecutor.execute(() -> {
            Bitmap loaded = null;
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "SpotyFlow-Android/10.0");
                conn.connect();
                if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    try (InputStream is = conn.getInputStream()) {
                        Bitmap raw = BitmapFactory.decodeStream(is);
                        if (raw != null) {
                            int maxDim = 512;
                            if (raw.getWidth() > maxDim || raw.getHeight() > maxDim) {
                                loaded = Bitmap.createScaledBitmap(raw, maxDim, maxDim, true);
                                if (loaded != raw) raw.recycle();
                            } else {
                                loaded = raw;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }

            final Bitmap finalArt = loaded != null ? loaded : getFallbackArtwork();
            if (finalArt != null && mainHandler != null) {
                mainHandler.post(() -> {
                    if (urlStr.equals(currentCoverUrl)) {
                        lastLoadedCoverUrl = urlStr;
                        cachedCoverBitmap = finalArt;
                        updatePlaybackStateAndNotification();
                    }
                });
            }
        });
    }

    private PendingIntent buildServiceActionIntent(String action, int requestCode) {
        Intent i = new Intent(this, SpotyFlowMediaService.class);
        i.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, requestCode, i, flags);
    }

    private PendingIntent buildContentIntent() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 100, launchIntent, flags);
    }

    private void updatePlaybackStateAndNotification() {
        if (mediaSession == null) return;

        Bitmap art = (cachedCoverBitmap != null && currentCoverUrl.equals(lastLoadedCoverUrl))
                ? cachedCoverBitmap
                : getFallbackArtwork();

        long safeDurationMs = currentDurationMs > 0L ? currentDurationMs : (isPlaying ? 180000L : 0L);
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, safeDurationMs);
        if (art != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }
        mediaSession.setMetadata(metaBuilder.build());

        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP;

        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, currentPositionMs, isPlaying ? currentPlaybackRate : 0f, SystemClock.elapsedRealtime())
                .build();
        mediaSession.setPlaybackState(playbackState);

        int playPauseIcon = isPlaying
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
        String playPauseLabel = isPlaying ? "Jeda" : "Putar";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setLargeIcon(art)
                .setContentIntent(buildContentIntent())
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColorized(true)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setDeleteIntent(buildServiceActionIntent(ACTION_STOP, 4))
                .addAction(android.R.drawable.ic_media_previous, "Sebelumnya", buildServiceActionIntent(ACTION_PREV, 1))
                .addAction(playPauseIcon, playPauseLabel, buildServiceActionIntent(ACTION_PLAY_PAUSE, 2))
                .addAction(android.R.drawable.ic_media_next, "Berikutnya", buildServiceActionIntent(ACTION_NEXT, 3))
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

        Notification notification = builder.build();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (isPlaying) {
            if (!isInForeground) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                    isInForeground = true;
                } catch (Exception e) {
                    if (nm != null) nm.notify(NOTIFICATION_ID, notification);
                }
            } else if (nm != null) {
                nm.notify(NOTIFICATION_ID, notification);
            }
        } else {
            if (isInForeground) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        stopForeground(STOP_FOREGROUND_DETACH);
                    } else {
                        stopForeground(false);
                    }
                } catch (Exception ignored) {
                }
                isInForeground = false;
            }
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    @Override
    public void onDestroy() {
        isPlaying = false;
        releasePowerLocks();
        if (noisyReceiverRegistered) {
            try {
                unregisterReceiver(noisyReceiver);
            } catch (Exception ignored) {
            }
            noisyReceiverRegistered = false;
        }
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) {
            }
            mediaSession = null;
        }
        if (artworkExecutor != null) {
            artworkExecutor.shutdownNow();
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!isPlaying) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
`;

const SPOTYFLOW_MEDIA_PLUGIN_JAVA = `package com.spotyflow.music;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SpotyFlowMedia")
public class SpotyFlowMediaPlugin extends Plugin {
    private static volatile SpotyFlowMediaPlugin activeInstance;
    private static volatile String pendingAuthNonce = null;
    private ExecutorService networkExecutor;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        if (networkExecutor == null || networkExecutor.isShutdown()) {
            networkExecutor = Executors.newCachedThreadPool();
        }
        if (pendingAuthNonce != null) {
            String n = pendingAuthNonce;
            pendingAuthNonce = null;
            emitAuthReturn(n);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        if (networkExecutor != null) {
            networkExecutor.shutdownNow();
            networkExecutor = null;
        }
        super.handleOnDestroy();
    }

    public static void emitMediaAction(String action, long positionMs) {
        SpotyFlowMediaPlugin inst = activeInstance;
        if (inst == null || action == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        if (positionMs >= 0L) {
            data.put("positionMs", positionMs);
        }
        inst.notifyListeners("mediaAction", data, true);
    }

    public static void emitAuthReturn(String nonce) {
        if (nonce == null || nonce.isEmpty()) return;
        SpotyFlowMediaPlugin inst = activeInstance;
        if (inst == null) {
            pendingAuthNonce = nonce;
            return;
        }
        JSObject data = new JSObject();
        data.put("nonce", nonce);
        inst.notifyListeners("authReturn", data, true);
    }

    public static void emitAppVisibility(boolean visible) {
        SpotyFlowMediaPlugin inst = activeInstance;
        if (inst == null) return;
        JSObject data = new JSObject();
        data.put("visible", visible);
        inst.notifyListeners("appVisibility", data, true);
    }

    @PluginMethod
    public void resolveYoutubeAudio(PluginCall call) {
        final String videoId = call.getString("videoId", "").trim();
        if (!videoId.matches("^[a-zA-Z0-9_-]{11}$")) {
            JSObject fail = new JSObject();
            fail.put("ok", false);
            call.resolve(fail);
            return;
        }
        if (networkExecutor == null || networkExecutor.isShutdown()) {
            networkExecutor = Executors.newCachedThreadPool();
        }
        networkExecutor.execute(() -> {
            JSObject result = fetchInnertubeAudio(videoId, "ANDROID_VR", "1.60.19", "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip");
            if (result == null) {
                result = fetchInnertubeAudio(videoId, "IOS", "19.29.1", "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)");
            }
            if (result == null) {
                result = new JSObject();
                result.put("ok", false);
            }
            call.resolve(result);
        });
    }

    private JSObject fetchInnertubeAudio(String videoId, String clientName, String clientVersion, String userAgent) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3800);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", userAgent);

            JSONObject client = new JSONObject();
            client.put("clientName", clientName);
            client.put("clientVersion", clientVersion);
            client.put("hl", "id");
            client.put("gl", "ID");
            if ("ANDROID_VR".equals(clientName)) {
                client.put("androidSdkVersion", 32);
                client.put("deviceMake", "Oculus");
                client.put("deviceModel", "Quest 3");
            } else {
                client.put("deviceMake", "Apple");
                client.put("deviceModel", "iPhone16,2");
            }

            JSONObject context = new JSONObject();
            context.put("client", client);
            JSONObject body = new JSONObject();
            body.put("videoId", videoId);
            body.put("context", context);
            body.put("contentCheckOk", true);
            body.put("racyCheckOk", true);

            byte[] payloadBytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payloadBytes);
            }

            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                return null;
            }

            StringBuilder sb = new StringBuilder();
            try (InputStream is = conn.getInputStream();
                 BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }

            JSONObject json = new JSONObject(sb.toString());
            JSONObject streamingData = json.optJSONObject("streamingData");
            if (streamingData == null) return null;
            JSONArray formats = streamingData.optJSONArray("adaptiveFormats");
            if (formats == null) return null;

            String bestUrl = null;
            String bestMime = "";
            int bestScore = -1;
            int bestBitrate = 0;

            for (int i = 0; i < formats.length(); i++) {
                JSONObject fmt = formats.optJSONObject(i);
                if (fmt == null) continue;
                String mime = fmt.optString("mimeType", "");
                if (!mime.startsWith("audio/")) continue;
                String streamUrl = fmt.optString("url", "");
                if (streamUrl.isEmpty() || !streamUrl.startsWith("https://")) continue;
                int bitrate = fmt.optInt("bitrate", 0);
                // Prefer hardware-decoded audio/mp4 (M4A/AAC) for zero CPU stutter on Android
                int bonus = mime.startsWith("audio/mp4") ? 1000000 : 0;
                int score = bonus + bitrate;
                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = streamUrl;
                    bestMime = mime.split(";")[0];
                    bestBitrate = bitrate;
                }
            }

            if (bestUrl == null) return null;
            JSONObject videoDetails = json.optJSONObject("videoDetails");
            long durSec = videoDetails != null ? videoDetails.optLong("lengthSeconds", 0L) : 0L;

            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("url", bestUrl);
            out.put("mimeType", bestMime);
            out.put("bitrate", bestBitrate);
            out.put("duration", durSec);
            out.put("client", clientName);
            return out;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String url = call.getString("url", "");
        Context ctx = getContext();
        if (ctx == null || url == null || (!url.startsWith("https://") && !url.startsWith("http://"))) {
            call.reject("Invalid URL");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open browser: " + e.getMessage());
        }
    }

    @PluginMethod
    public void updatePlayback(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.resolve();
            return;
        }
        String title = call.getString("title", "SpotyFlow");
        String artist = call.getString("artist", "SpotyFlow Studio");
        String album = call.getString("album", "SpotyFlow");
        String coverUrl = call.getString("coverUrl", "");
        Boolean playingObj = call.getBoolean("isPlaying", false);
        boolean playing = playingObj != null && playingObj;
        Double durObj = call.getDouble("durationMs", 0.0);
        long durationMs = durObj != null ? Math.max(0L, Math.round(durObj)) : 0L;
        Double posObj = call.getDouble("positionMs", 0.0);
        long positionMs = posObj != null ? Math.max(0L, Math.round(posObj)) : 0L;
        Float rateObj = call.getFloat("playbackRate", 1.0f);
        float playbackRate = rateObj != null ? rateObj : 1.0f;

        SpotyFlowMediaService.isPlaying = playing;

        Intent intent = new Intent(ctx, SpotyFlowMediaService.class);
        intent.setAction(SpotyFlowMediaService.ACTION_UPDATE);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("album", album);
        intent.putExtra("coverUrl", coverUrl);
        intent.putExtra("isPlaying", playing);
        intent.putExtra("durationMs", durationMs);
        intent.putExtra("positionMs", positionMs);
        intent.putExtra("playbackRate", playbackRate);

        try {
            if (playing) {
                ContextCompat.startForegroundService(ctx, intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Context ctx = getContext();
        SpotyFlowMediaService.isPlaying = false;
        if (ctx != null) {
            try {
                ctx.stopService(new Intent(ctx, SpotyFlowMediaService.class));
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }
}
`;

const SPOTYFLOW_WEBVIEW_JAVA = `package com.spotyflow.music;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

public class SpotyFlowWebView extends CapacitorWebView {
    public SpotyFlowWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != View.VISIBLE && SpotyFlowMediaService.isPlaying) {
            super.onWindowVisibilityChanged(View.VISIBLE);
            return;
        }
        super.onWindowVisibilityChanged(visibility);
    }

    @Override
    public void onPause() {
        if (SpotyFlowMediaService.isPlaying) {
            return;
        }
        super.onPause();
    }

    @Override
    public void pauseTimers() {
        if (SpotyFlowMediaService.isPlaying) {
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

    <com.spotyflow.music.SpotyFlowWebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`;

const MAIN_ACTIVITY_JAVA = `package com.spotyflow.music;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 2026;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpotyFlowMediaPlugin.class);
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_POST_NOTIFICATIONS
                );
            }
        }

        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {
        }

        handleDeepLinkIntent(getIntent());
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
                SpotyFlowMediaPlugin.emitAuthReturn(nonce);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        SpotyFlowMediaPlugin.emitAppVisibility(true);
    }

    @Override
    public void onPause() {
        super.onPause();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onStop() {
        SpotyFlowMediaPlugin.emitAppVisibility(false);
        super.onStop();
        scheduleBackgroundWebViewKeepAlive();
    }

    private void scheduleBackgroundWebViewKeepAlive() {
        keepBackgroundAudioWebViewAlive();
        try {
            android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            h.postDelayed(this::keepBackgroundAudioWebViewAlive, 150L);
            h.postDelayed(this::keepBackgroundAudioWebViewAlive, 500L);
        } catch (Exception ignored) {
        }
    }

    private void keepBackgroundAudioWebViewAlive() {
        try {
            if (SpotyFlowMediaService.isPlaying && getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.onResume();
                webView.resumeTimers();
            }
        } catch (Exception ignored) {
        }
    }
}
`;

function patchBuildGradle() {
  if (!fs.existsSync(BUILD_GRADLE)) {
    throw new Error(`Tidak ditemukan ${BUILD_GRADLE}. Pastikan npx cap add android sudah dijalankan.`);
  }
  let content = fs.readFileSync(BUILD_GRADLE, 'utf8');

  // 1. Add androidx.media:media:1.7.0 dependency
  if (!content.includes("androidx.media:media:1.7.0")) {
    content = content.replace(
      /dependencies\s*\{/,
      "dependencies {\n    implementation 'androidx.media:media:1.7.0'"
    );
  }

  // 2. Ensure noCompress includes wav and wasm inside android { ... }
  if (!content.includes('"wav"') || !content.includes('"wasm"')) {
    if (/androidResources\s*\{/.test(content)) {
      content = content.replace(
        /androidResources\s*\{/,
        'androidResources {\n        noCompress += ["wav", "wasm"]'
      );
    } else if (/aaptOptions\s*\{/.test(content)) {
      content = content.replace(
        /aaptOptions\s*\{/,
        'aaptOptions {\n        noCompress "wav", "wasm"'
      );
    } else {
      content = content.replace(
        /android\s*\{/,
        'android {\n    androidResources {\n        noCompress += ["wav", "wasm"]\n    }'
      );
    }
  }

  fs.writeFileSync(BUILD_GRADLE, content, 'utf8');
  console.log('  + Patched android/app/build.gradle (androidx.media:1.7.0 + noCompress wav/wasm)');
}

function patchAndroidManifest() {
  if (!fs.existsSync(MANIFEST_XML)) {
    throw new Error(`Tidak ditemukan ${MANIFEST_XML}.`);
  }
  let xml = fs.readFileSync(MANIFEST_XML, 'utf8');

  // Ensure ZERO SYSTEM_ALERT_WINDOW / overlay permission exists
  xml = xml.replace(/\s*<uses-permission[^>]*SYSTEM_ALERT_WINDOW[^>]*\/>\s*/g, '\n');

  const requiredPermissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.POST_NOTIFICATIONS',
  ];

  const missingPerms = requiredPermissions.filter((p) => !xml.includes(`android:name="${p}"`));
  if (missingPerms.length) {
    const permBlock = missingPerms
      .map((p) => `    <uses-permission android:name="${p}" />`)
      .join('\n');
    xml = xml.replace(/<manifest([^>]*)>/, `<manifest$1>\n${permBlock}`);
  }

  // Set android:largeHeap="true" and android:usesCleartextTraffic="true" on <application>
  xml = xml.replace(/<application\b([^>]*)>/, (full, attrs) => {
    let nextAttrs = attrs;
    if (!/android:largeHeap\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:largeHeap="true"';
    }
    if (!/android:usesCleartextTraffic\s*=/.test(nextAttrs)) {
      nextAttrs += '\n        android:usesCleartextTraffic="true"';
    }
    return `<application${nextAttrs}>`;
  });

  // Register spotyflow:// deep link on MainActivity so Chrome OAuth returns automatically
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

  // Register SpotyFlowMediaService inside <application>
  if (!xml.includes('android:name=".SpotyFlowMediaService"')) {
    const serviceBlock = `
        <service
            android:name=".SpotyFlowMediaService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    `;
    xml = xml.replace('</application>', `${serviceBlock}\n    </application>`);
  }

  fs.writeFileSync(MANIFEST_XML, xml, 'utf8');
  console.log('  + Patched AndroidManifest.xml (6 clean permissions, largeHeap, spotyflow:// deep link, mediaPlayback service)');
}

function writeJavaSources() {
  fs.mkdirSync(JAVA_PKG_DIR, { recursive: true });
  fs.mkdirSync(RES_LAYOUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowMediaService.java'), SPOTYFLOW_MEDIA_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowMediaPlugin.java'), SPOTYFLOW_MEDIA_PLUGIN_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), SPOTYFLOW_WEBVIEW_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), MAIN_ACTIVITY_JAVA, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  console.log('  + Written SpotyFlowMediaService.java, SpotyFlowMediaPlugin.java, SpotyFlowWebView.java, MainActivity.java, bridge_layout_main.xml');
}

function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
  }
  console.log('[SpotyFlow Android Patcher] Applying Spotify-style native MediaSession & Background Playback patches...');
  patchBuildGradle();
  patchAndroidManifest();
  writeJavaSources();
  console.log('[SpotyFlow Android Patcher] SELESAI — siap kompilasi Gradle!');
}

main();
