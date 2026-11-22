'use strict';
/**
 * SpotyFlow Native Android Patcher (scripts/patch-android-apk.js)
 * Runs automatically after `npx cap sync android` to inject official Spotify-style native Android architecture:
 *  - androidx.media:media:1.7.0 + noCompress ["wav", "wasm"] in android/app/build.gradle
 *  - Monochrome 24dp vector notification icon (res/drawable/ic_stat_music.xml)
 *  - Full Spotify-equivalent permissions (NO SYSTEM_ALERT_WINDOW / NO fake overlays!), appCategory="audio",
 *    spotyflow:// deep link, MediaBrowserServiceCompat + MediaButtonReceiver in AndroidManifest.xml
 *  - NativeYouTubeResolver.java (on-device residential-IP YouTube IOS/ANDROID/VR audio-only M4A/AAC resolver)
 *  - SpotyFlowMediaService.java (MediaBrowserServiceCompat + 4 Spotify-style notification channels + in-process
 *    dispatchPlaybackUpdate anti-crash + MediaSessionCompat + MediaStyle + WakeLock/WifiLock + Noisy receiver)
 *  - SpotyFlowWebView.java + res/layout/bridge_layout_main.xml (keeps HTML5 <audio> & timers alive when locked)
 *  - MainActivity.java (unified @JavascriptInterface "SpotyFlowNative", 4 channels boot init, single-shot runtime
 *    permissions + battery optimization exemption, Chrome OAuth deep link, background keep-alive)
 *  - Strict post-patch verification (process.exit(1) on any failure)
 *
 * 100% compatible with Android 8 – Android 16 (API 26–36), Capacitor 6, Java 17 & Gradle 8.
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
const RES_DRAWABLE_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'drawable');

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

const NATIVE_YOUTUBE_RESOLVER_JAVA = `package com.spotyflow.music;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NativeYouTubeResolver {

    public static JSONObject resolveAudioStream(String videoId) {
        JSONObject fail = new JSONObject();
        try {
            fail.put("ok", false);
        } catch (Exception ignored) {
        }

        if (videoId == null || !videoId.trim().matches("^[a-zA-Z0-9_-]{11}$")) {
            try {
                fail.put("error", "Invalid videoId");
            } catch (Exception ignored) {
            }
            return fail;
        }
        String vid = videoId.trim();

        // 1. Primary: IOS Innertube client (direct hardware-friendly audio/mp4 M4A itag 140 from device IP)
        JSONObject iosRes = queryInnertube(
                vid,
                "IOS",
                "20.10.4",
                "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
        );
        if (iosRes != null) return iosRes;

        // 2. Fallback: ANDROID Innertube client
        JSONObject androidRes = queryInnertube(
                vid,
                "ANDROID",
                "20.10.38",
                "com.google.android.youtube/20.10.38 (Linux; U; Android 14; Pixel 8 Build/UQ1A.240205.002) gzip"
        );
        if (androidRes != null) return androidRes;

        // 3. Fallback: ANDROID_VR Innertube client
        JSONObject vrRes = queryInnertube(
                vid,
                "ANDROID_VR",
                "1.60.19",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        );
        if (vrRes != null) return vrRes;

        try {
            fail.put("error", "No direct audio stream available");
        } catch (Exception ignored) {
        }
        return fail;
    }

    private static JSONObject queryInnertube(String videoId, String clientName, String clientVersion, String userAgent) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4500);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", userAgent);

            JSONObject client = new JSONObject();
            client.put("clientName", clientName);
            client.put("clientVersion", clientVersion);
            client.put("hl", "id");
            client.put("gl", "ID");
            if ("IOS".equals(clientName)) {
                client.put("deviceMake", "Apple");
                client.put("deviceModel", "iPhone16,2");
                client.put("osName", "iOS");
                client.put("osVersion", "18.3.2");
            } else if ("ANDROID_VR".equals(clientName)) {
                client.put("androidSdkVersion", 32);
                client.put("deviceMake", "Oculus");
                client.put("deviceModel", "Quest 3");
            } else {
                client.put("androidSdkVersion", 34);
                client.put("deviceMake", "Google");
                client.put("deviceModel", "Pixel 8");
            }

            JSONObject context = new JSONObject();
            context.put("client", client);

            JSONObject body = new JSONObject();
            body.put("videoId", videoId);
            body.put("context", context);
            body.put("contentCheckOk", true);
            body.put("racyCheckOk", true);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
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

            JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
            if (adaptive == null || adaptive.length() == 0) return null;

            String bestUrl = null;
            String bestMime = "";
            int bestBitrate = 0;
            int bestScore = -1;

            for (int i = 0; i < adaptive.length(); i++) {
                JSONObject fmt = adaptive.optJSONObject(i);
                if (fmt == null) continue;
                String mime = fmt.optString("mimeType", "");
                if (!mime.startsWith("audio/")) continue;
                String streamUrl = fmt.optString("url", "");
                if (streamUrl.isEmpty() || !streamUrl.startsWith("https://")) continue;

                int itag = fmt.optInt("itag", 0);
                int bitrate = fmt.optInt("bitrate", 0);
                int score = bitrate;
                if (mime.startsWith("audio/mp4")) score += 2000000;
                if (itag == 140) score += 500000; // Standard 128k AAC M4A (zero stutter on Android hardware)

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = streamUrl;
                    bestMime = mime.split(";")[0];
                    bestBitrate = bitrate;
                }
            }

            if (bestUrl == null) return null;

            JSONObject videoDetails = json.optJSONObject("videoDetails");
            long durationSec = videoDetails != null ? videoDetails.optLong("lengthSeconds", 0L) : 0L;

            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            ok.put("url", bestUrl);
            ok.put("duration", durationSec);
            ok.put("bitrate", bestBitrate);
            ok.put("mimeType", bestMime);
            ok.put("client", clientName);
            return ok;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
`;

const SPOTYFLOW_MEDIA_SERVICE_JAVA = `package com.spotyflow.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SpotyFlowMediaService extends MediaBrowserServiceCompat {
    public static final String CHANNEL_GENERAL = "spotyflow_general";
    public static final String CHANNEL_PLAYBACK = "spotyflow_playback";
    public static final String CHANNEL_MUSIC = "spotyflow_music";
    public static final String CHANNEL_DOWNLOADS = "spotyflow_downloads";

    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_UPDATE = "com.spotyflow.music.ACTION_UPDATE";
    public static final String ACTION_PLAY_PAUSE = "com.spotyflow.music.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.spotyflow.music.ACTION_NEXT";
    public static final String ACTION_PREV = "com.spotyflow.music.ACTION_PREV";
    public static final String ACTION_STOP = "com.spotyflow.music.ACTION_STOP";

    public static volatile SpotyFlowMediaService instance = null;
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
    private long currentDurationMs = 180000L;
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
                MainActivity.dispatchMediaActionToWebView("noisy", -1L);
                updatePlaybackStateAndNotification(true);
            }
        }
    };

    public static void ensureNotificationChannels(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            // 1. SpotyFlow General (Pop-up + Badge + Priority)
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

            // 2. Playback (Silent media controls — Spotify style)
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

            // 3. SpotyFlow Music
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

            // 4. Offline & Unduhan
            NotificationChannel downloads = new NotificationChannel(
                    CHANNEL_DOWNLOADS,
                    "Offline & Unduhan",
                    NotificationManager.IMPORTANCE_LOW
            );
            downloads.setDescription("Status penyimpanan lagu offline & aset audio HD");
            downloads.setSound(null, null);
            downloads.enableVibration(false);
            downloads.setShowBadge(false);
            manager.createNotificationChannel(downloads);
        } catch (Exception ignored) {
        }
    }

    public static void dispatchPlaybackUpdate(
            Context ctx,
            String title,
            String artist,
            String album,
            String coverUrl,
            boolean playing,
            long durationMs,
            long positionMs,
            float playbackRate
    ) {
        isPlaying = playing;
        SpotyFlowMediaService active = instance;
        if (active != null && active.mainHandler != null) {
            // Update langsung in-process — 100% anti ForegroundServiceStartNotAllowedException saat auto-next layar terkunci!
            active.mainHandler.post(() -> active.applyPlaybackUpdate(
                    title, artist, album, coverUrl, playing, durationMs, positionMs, playbackRate
            ));
            return;
        }
        if (ctx == null) return;
        Intent intent = new Intent(ctx, SpotyFlowMediaService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("album", album);
        intent.putExtra("coverUrl", coverUrl);
        intent.putExtra("isPlaying", playing);
        intent.putExtra("durationMs", durationMs);
        intent.putExtra("positionMs", positionMs);
        intent.putExtra("playbackRate", playbackRate);
        try {
            ContextCompat.startForegroundService(ctx, intent);
        } catch (Exception e) {
            try {
                ctx.startService(intent);
            } catch (Exception ignored) {
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
        initMediaSession();
        registerNoisyReceiverSafe();
    }

    private void initMediaSession() {
        ComponentName mediaButtonReceiver = new ComponentName(this, MediaButtonReceiver.class);
        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setComponent(mediaButtonReceiver);
        PendingIntent mediaButtonPendingIntent = PendingIntent.getBroadcast(
                this,
                0,
                mediaButtonIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        mediaSession = new MediaSessionCompat(this, "SpotyFlowMediaSession", mediaButtonReceiver, mediaButtonPendingIntent);
        mediaSession.setPlaybackToLocal(AudioManager.STREAM_MUSIC);
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setSessionActivity(buildContentIntent());
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                MainActivity.dispatchMediaActionToWebView("play", -1L);
            }

            @Override
            public void onPause() {
                MainActivity.dispatchMediaActionToWebView("pause", -1L);
            }

            @Override
            public void onSkipToNext() {
                MainActivity.dispatchMediaActionToWebView("next", -1L);
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.dispatchMediaActionToWebView("prev", -1L);
            }

            @Override
            public void onSeekTo(long pos) {
                currentPositionMs = Math.max(0L, pos);
                MainActivity.dispatchMediaActionToWebView("seek", currentPositionMs);
                updatePlaybackStateOnly();
            }

            @Override
            public void onStop() {
                isPlaying = false;
                releasePowerLocks();
                MainActivity.dispatchMediaActionToWebView("pause", -1L);
                stopSelf();
            }
        });
        setSessionToken(mediaSession.getSessionToken());
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
        if (Intent.ACTION_MEDIA_BUTTON.equals(action)) {
            MediaButtonReceiver.handleIntent(mediaSession, intent);
            return START_STICKY;
        }
        if (ACTION_PLAY_PAUSE.equals(action)) {
            MainActivity.dispatchMediaActionToWebView(isPlaying ? "pause" : "play", -1L);
            return START_STICKY;
        } else if (ACTION_NEXT.equals(action)) {
            MainActivity.dispatchMediaActionToWebView("next", -1L);
            return START_STICKY;
        } else if (ACTION_PREV.equals(action)) {
            MainActivity.dispatchMediaActionToWebView("prev", -1L);
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
        long durationMs = intent.getLongExtra("durationMs", 180000L);
        long positionMs = intent.getLongExtra("positionMs", 0L);
        float playbackRate = intent.getFloatExtra("playbackRate", 1.0f);

        applyPlaybackUpdate(title, artist, album, coverUrl, playing, durationMs, positionMs, playbackRate);
        return START_STICKY;
    }

    private void applyPlaybackUpdate(
            String title,
            String artist,
            String album,
            String coverUrl,
            boolean playing,
            long durationMs,
            long positionMs,
            float playbackRate
    ) {
        String nextTitle = (title != null && !title.isEmpty()) ? title : currentTitle;
        String nextArtist = (artist != null && !artist.isEmpty()) ? artist : currentArtist;
        String nextAlbum = (album != null && !album.isEmpty()) ? album : currentAlbum;
        String nextCover = coverUrl != null ? coverUrl : "";
        long nextDur = Math.max(1000L, durationMs > 0L ? durationMs : currentDurationMs);
        long nextPos = Math.max(0L, positionMs);
        float nextRate = playbackRate > 0f ? playbackRate : 1.0f;

        boolean visualChanged = !isInForeground
                || playing != isPlaying
                || !nextTitle.equals(currentTitle)
                || !nextArtist.equals(currentArtist)
                || !nextAlbum.equals(currentAlbum)
                || !nextCover.equals(currentCoverUrl)
                || Math.abs(nextDur - currentDurationMs) >= 1000L;

        currentTitle = nextTitle;
        currentArtist = nextArtist;
        currentAlbum = nextAlbum;
        currentCoverUrl = nextCover;
        currentDurationMs = nextDur;
        currentPositionMs = nextPos;
        currentPlaybackRate = nextRate;
        isPlaying = playing;

        if (isPlaying) {
            acquirePowerLocks();
        } else {
            releasePowerLocks();
        }

        if (visualChanged) {
            updatePlaybackStateAndNotification(false);
        } else {
            updatePlaybackStateOnly();
        }
        loadCoverArtworkAsync(currentCoverUrl);
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
                        updatePlaybackStateAndNotification(true);
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

    private void updatePlaybackStateOnly() {
        if (mediaSession == null) return;
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
        mediaSession.setActive(true);
    }

    private void updatePlaybackStateAndNotification(boolean notifyOnlyIfAlreadyForeground) {
        if (mediaSession == null) return;

        Bitmap art = (cachedCoverBitmap != null && currentCoverUrl.equals(lastLoadedCoverUrl))
                ? cachedCoverBitmap
                : getFallbackArtwork();

        long safeDurationMs = Math.max(1000L, currentDurationMs);
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, currentTitle + "_" + currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, currentArtist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, safeDurationMs);
        if (art != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }
        mediaSession.setMetadata(metaBuilder.build());
        updatePlaybackStateOnly();

        int playPauseIcon = isPlaying
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
        String playPauseLabel = isPlaying ? "Jeda" : "Putar";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_PLAYBACK)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setLargeIcon(art)
                .setContentIntent(buildContentIntent())
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
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

        if (!isInForeground || (!notifyOnlyIfAlreadyForeground && isPlaying)) {
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

        if (!isPlaying && isInForeground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH);
                } else {
                    stopForeground(false);
                }
                isInForeground = false;
            } catch (Exception ignored) {
            }
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        isPlaying = false;
        isInForeground = false;
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
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        return new BrowserRoot("spotyflow_root", null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.sendResult(new ArrayList<>());
    }
}
`;

const SPOTYFLOW_WEBVIEW_JAVA = `package com.spotyflow.music;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

import java.util.Map;

public class SpotyFlowWebView extends CapacitorWebView {
    private boolean nativeBridgeReady = false;

    public SpotyFlowWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    private void ensureNativeBridgeBeforeLoad() {
        if (nativeBridgeReady) return;
        nativeBridgeReady = true;
        MainActivity.attachNativeBridgeToWebView(this);
    }

    @Override
    public void loadUrl(String url) {
        ensureNativeBridgeBeforeLoad();
        super.loadUrl(url);
    }

    @Override
    public void loadUrl(String url, Map<String, String> additionalHttpHeaders) {
        ensureNativeBridgeBeforeLoad();
        super.loadUrl(url, additionalHttpHeaders);
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
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {
    private static final int REQ_SPOTYFLOW_PERMISSIONS = 1001;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);
    private ExecutorService resolverExecutor;
    private boolean bridgeAttached = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        resolverExecutor = Executors.newCachedThreadPool();
        // Langsung daftarkan 4 kategori notifikasi persis Spotify sebelum WebView mulai memuat
        SpotyFlowMediaService.ensureNotificationChannels(this);

        super.onCreate(savedInstanceState);

        // Pastikan bridge terpasang (jika belum terpasang via SpotyFlowWebView.loadUrl)
        if (getBridge() != null && getBridge().getWebView() != null) {
            attachNativeBridgeInstance(getBridge().getWebView());
        }

        requestSpotifyLikePermissions();
        requestBatteryOptimizationExemptionOnce();
        handleDeepLinkIntent(getIntent());
    }

    public static void attachNativeBridgeToWebView(WebView webView) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act != null && webView != null) {
            act.attachNativeBridgeInstance(webView);
        }
    }

    private void attachNativeBridgeInstance(WebView webView) {
        if (bridgeAttached || webView == null) return;
        bridgeAttached = true;
        try {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            String ua = settings.getUserAgentString();
            if (ua == null) ua = "";
            if (!ua.contains("SpotyFlowApp/")) {
                settings.setUserAgentString(ua + " SpotyFlowApp/3.0");
            }
            webView.addJavascriptInterface(new SpotyFlowNativeBridge(), "SpotyFlowNative");
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

    public static void dispatchMediaActionToWebView(final String action, final long positionMs) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || action == null) return;
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "if(window.__sfHandleNativeMediaAction){window.__sfHandleNativeMediaAction("
                            + JSONObject.quote(action) + "," + positionMs + ");}";
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
                    String js = "if(window.__sfHandleNativeAppVisibility){window.__sfHandleNativeAppVisibility("
                            + (visible ? "true" : "false") + ");}";
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
                    String js = "if(window.__sfHandleNativeAuthReturn){window.__sfHandleNativeAuthReturn("
                            + JSONObject.quote(nonce) + ");}";
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
        if (resolverExecutor != null) {
            resolverExecutor.shutdownNow();
            resolverExecutor = null;
        }
        super.onDestroy();
    }

    private void scheduleBackgroundWebViewKeepAlive() {
        keepBackgroundAudioWebViewAlive();
        try {
            Handler h = new Handler(Looper.getMainLooper());
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

    private class SpotyFlowNativeBridge {
        @JavascriptInterface
        public boolean isNativeApk() {
            return true;
        }

        @JavascriptInterface
        public void updatePlayback(String jsonPayload) {
            try {
                JSONObject obj = new JSONObject(jsonPayload != null ? jsonPayload : "{}");
                String title = obj.optString("title", "SpotyFlow");
                String artist = obj.optString("artist", "SpotyFlow Studio");
                String album = obj.optString("album", "SpotyFlow");
                String coverUrl = obj.optString("coverUrl", "");
                boolean playing = obj.optBoolean("isPlaying", false);
                long durationMs = Math.max(1000L, obj.optLong("durationMs", 180000L));
                long positionMs = Math.max(0L, obj.optLong("positionMs", 0L));
                float playbackRate = (float) obj.optDouble("playbackRate", 1.0);
                SpotyFlowMediaService.dispatchPlaybackUpdate(
                        getApplicationContext(),
                        title, artist, album, coverUrl,
                        playing, durationMs, positionMs, playbackRate
                );
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void updateNowPlaying(String title, String artist, boolean playing) {
            SpotyFlowMediaService.dispatchPlaybackUpdate(
                    getApplicationContext(),
                    title != null ? title : "SpotyFlow",
                    artist != null ? artist : "SpotyFlow Studio",
                    "SpotyFlow",
                    "",
                    playing,
                    180000L,
                    0L,
                    1.0f
            );
        }

        @JavascriptInterface
        public void stopService() {
            SpotyFlowMediaService.isPlaying = false;
            try {
                getApplicationContext().stopService(new Intent(getApplicationContext(), SpotyFlowMediaService.class));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void resolveFullAudioAsync(final String videoId, final String reqId) {
            if (resolverExecutor == null || resolverExecutor.isShutdown()) {
                resolverExecutor = Executors.newCachedThreadPool();
            }
            resolverExecutor.execute(() -> {
                final JSONObject result = NativeYouTubeResolver.resolveAudioStream(videoId);
                runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            String js = "if(window.__onNativeAudioResolved){window.__onNativeAudioResolved("
                                    + JSONObject.quote(reqId != null ? reqId : "")
                                    + ","
                                    + result.toString()
                                    + ");}";
                            getBridge().getWebView().evaluateJavascript(js, null);
                        }
                    } catch (Exception ignored) {
                    }
                });
            });
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

function patchBuildGradle() {
  if (!fs.existsSync(BUILD_GRADLE)) {
    throw new Error(`Tidak ditemukan ${BUILD_GRADLE}. Pastikan npx cap add android sudah dijalankan.`);
  }
  let content = fs.readFileSync(BUILD_GRADLE, 'utf8');

  if (!content.includes("androidx.media:media:1.7.0")) {
    content = content.replace(
      /dependencies\s*\{/,
      "dependencies {\n    implementation 'androidx.media:media:1.7.0'"
    );
  }

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

  // Set android:appCategory="audio", android:largeHeap="true", android:usesCleartextTraffic="true" on <application>
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

  // Register SpotyFlowMediaService (MediaBrowserServiceCompat + MEDIA_BUTTON) & MediaButtonReceiver
  if (!xml.includes('android:name=".SpotyFlowMediaService"')) {
    const serviceBlock = `
        <service
            android:name=".SpotyFlowMediaService"
            android:enabled="true"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="android.media.browse.MediaBrowserService" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </service>

        <receiver
            android:name="androidx.media.session.MediaButtonReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </receiver>
    `;
    xml = xml.replace('</application>', `${serviceBlock}\n    </application>`);
  }

  fs.writeFileSync(MANIFEST_XML, xml, 'utf8');
  console.log('  + Patched AndroidManifest.xml (14 Spotify-style permissions, appCategory=audio, MediaBrowserService, MediaButtonReceiver, spotyflow://)');
}

function writeJavaAndResSources() {
  fs.mkdirSync(JAVA_PKG_DIR, { recursive: true });
  fs.mkdirSync(RES_LAYOUT_DIR, { recursive: true });
  fs.mkdirSync(RES_DRAWABLE_DIR, { recursive: true });

  // Clean up legacy Capacitor plugin class if present so there are zero stale references
  const legacyPlugin = path.join(JAVA_PKG_DIR, 'SpotyFlowMediaPlugin.java');
  if (fs.existsSync(legacyPlugin)) {
    fs.rmSync(legacyPlugin, { force: true });
  }

  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'), NATIVE_YOUTUBE_RESOLVER_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowMediaService.java'), SPOTYFLOW_MEDIA_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), SPOTYFLOW_WEBVIEW_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), MAIN_ACTIVITY_JAVA, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'), IC_STAT_MUSIC_XML, 'utf8');

  console.log('  + Written NativeYouTubeResolver.java, SpotyFlowMediaService.java, SpotyFlowWebView.java, MainActivity.java, bridge_layout_main.xml, ic_stat_music.xml');
}

function verifyPatchedProject() {
  const mustExist = [
    BUILD_GRADLE,
    MANIFEST_XML,
    path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowMediaService.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'),
    path.join(JAVA_PKG_DIR, 'MainActivity.java'),
    path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'),
  ];
  for (const f of mustExist) {
    if (!fs.existsSync(f)) {
      console.error('[SpotyFlow Android Patcher] VERIFY FAILED — file tidak ditemukan:', f);
      process.exit(1);
    }
  }

  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const manifest = fs.readFileSync(MANIFEST_XML, 'utf8');
  const svc = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowMediaService.java'), 'utf8');
  const act = fs.readFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), 'utf8');
  const res = fs.readFileSync(path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'), 'utf8');

  const checks = [
    [gradle.includes('androidx.media:media:1.7.0'), 'build.gradle missing androidx.media:media:1.7.0'],
    [gradle.includes('"wav"') && gradle.includes('"wasm"'), 'build.gradle missing noCompress wav/wasm'],
    [manifest.includes('android:appCategory="audio"'), 'Manifest missing appCategory="audio"'],
    [manifest.includes('android.media.browse.MediaBrowserService'), 'Manifest missing MediaBrowserService'],
    [manifest.includes('androidx.media.session.MediaButtonReceiver'), 'Manifest missing MediaButtonReceiver'],
    [manifest.includes('android.permission.BLUETOOTH_CONNECT'), 'Manifest missing BLUETOOTH_CONNECT'],
    [manifest.includes('android.permission.READ_MEDIA_AUDIO'), 'Manifest missing READ_MEDIA_AUDIO'],
    [manifest.includes('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'), 'Manifest missing REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'],
    [!manifest.includes('SYSTEM_ALERT_WINDOW'), 'Manifest must NOT include SYSTEM_ALERT_WINDOW'],
    [svc.includes('spotyflow_general') && svc.includes('spotyflow_playback') && svc.includes('spotyflow_music') && svc.includes('spotyflow_downloads'), 'Service missing 4 notification channels'],
    [svc.includes('dispatchPlaybackUpdate') && svc.includes('setPlaybackToLocal(AudioManager.STREAM_MUSIC)'), 'Service missing dispatchPlaybackUpdate or setPlaybackToLocal'],
    [!svc.includes('requestAudioFocus'), 'Service must NOT call requestAudioFocus'],
    [act.includes('addJavascriptInterface') && act.includes('"SpotyFlowNative"') && act.includes('SpotyFlowApp/3.0'), 'MainActivity missing SpotyFlowNative interface or UA'],
    [res.includes('resolveAudioStream') && res.includes('20.10.4'), 'NativeYouTubeResolver missing IOS 20.10.4 client'],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error('[SpotyFlow Android Patcher] VERIFY FAILED:', msg);
      process.exit(1);
    }
  }
  console.log('  + Strict self-verification passed (14/14 native checks)');
}

function main() {
  try {
    if (!fs.existsSync(ANDROID_DIR)) {
      throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
    }
    console.log('[SpotyFlow Android Patcher] Applying unified SpotyFlowNative + NativeYouTubeResolver + 4-Channel MediaBrowserServiceCompat...');
    patchBuildGradle();
    patchAndroidManifest();
    writeJavaAndResSources();
    verifyPatchedProject();
    console.log('[SpotyFlow Android Patcher] SELESAI — siap kompilasi Gradle!');
  } catch (err) {
    console.error('[SpotyFlow Android Patcher] ERROR:', err?.message || err);
    process.exit(1);
  }
}

main();
