'use strict';
/**
 * SpotyFlow Native AndroidX Media3 ExoPlayer + Hardware DSP Patcher (scripts/patch-android-apk.js)
 * Runs automatically after `npx cap sync android` to inject:
 *  - compileSdkVersion = 34, targetSdkVersion = 34, minSdkVersion = 24 (android/variables.gradle)
 *  - AndroidX Media3 1.4.1 (exoplayer, session, common) + Guava + Java 17 (android/app/build.gradle)
 *  - Monochrome 24dp vector music note icon (res/drawable/ic_stat_music.xml)
 *  - Full Spotify-equivalent permissions (ZERO SYSTEM_ALERT_WINDOW), appCategory="audio",
 *    spotyflow:// deep link, SpotyFlowPlaybackService (MediaSessionService) + MediaButtonReceiver
 *  - NativeYouTubeResolver.java (IOS 20.10.4 -> ANDROID 20.10.38 -> Piped fallback)
 *  - SpotyFlowPlaybackService.java (Media3 ExoPlayer + Hardware Equalizer 5-Band, BassBoost,
 *    LoudnessEnhancer, PresetReverb, Pitch/Speed + 4 Spotify Notification Channels + ForwardingPlayer)
 *  - SpotyFlowWebView.java + res/layout/bridge_layout_main.xml (pre-loadUrl bridge & lockscreen timer keep-alive)
 *  - MainActivity.java (@JavascriptInterface "SpotyFlowExo", MediaController binding, 500ms ticker,
 *    Chrome Google OAuth deep link, 1x runtime permissions & battery optimization exemption)
 *  - Strict post-patch verification (process.exit(1) on any failure)
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const VARIABLES_GRADLE = path.join(ANDROID_DIR, 'variables.gradle');
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
    private static final String IOS_UA =
            "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    private static final String ANDROID_UA =
            "com.google.android.youtube/20.10.38 (Linux; U; Android 14; Pixel 8 Build/UQ1A.240205.002) gzip";
    private static final String BROWSER_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

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

        // 1. Primary: YouTube Innertube IOS client (direct M4A itag 140/139 from device IP)
        JSONObject iosRes = queryInnertube(vid, "IOS", "20.10.4", IOS_UA);
        if (iosRes != null) return iosRes;

        // 2. Fallback: YouTube Innertube ANDROID client
        JSONObject androidRes = queryInnertube(vid, "ANDROID", "20.10.38", ANDROID_UA);
        if (androidRes != null) return androidRes;

        // 3. Fallback: 2 public Piped instances
        String[] pipedHosts = new String[] {
                "https://pipedapi.kavin.rocks",
                "https://pipedapi.adminforge.de"
        };
        for (String host : pipedHosts) {
            JSONObject pipedRes = queryPiped(host, vid);
            if (pipedRes != null) return pipedRes;
        }

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
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(5000);
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
                if (itag == 140) score += 600000;
                else if (itag == 139) score += 250000;

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
            ok.put("userAgent", userAgent);
            ok.put("client", clientName);
            return ok;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static JSONObject queryPiped(String baseUrl, String videoId) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl + "/streams/" + videoId);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(4000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", BROWSER_UA);

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
            JSONArray audioStreams = json.optJSONArray("audioStreams");
            if (audioStreams == null || audioStreams.length() == 0) return null;

            String bestUrl = null;
            String bestMime = "";
            int bestBitrate = 0;
            int bestScore = -1;

            for (int i = 0; i < audioStreams.length(); i++) {
                JSONObject st = audioStreams.optJSONObject(i);
                if (st == null) continue;
                String streamUrl = st.optString("url", "");
                if (streamUrl.isEmpty() || !streamUrl.startsWith("https://")) continue;
                String mime = st.optString("mimeType", "audio/mp4");
                int bitrate = st.optInt("bitrate", 0);
                int score = bitrate + (mime.startsWith("audio/mp4") ? 1500000 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = streamUrl;
                    bestMime = mime.split(";")[0];
                    bestBitrate = bitrate;
                }
            }

            if (bestUrl == null) return null;

            long durationSec = json.optLong("duration", 0L);
            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            ok.put("url", bestUrl);
            ok.put("duration", durationSec);
            ok.put("bitrate", bestBitrate);
            ok.put("mimeType", bestMime);
            ok.put("userAgent", BROWSER_UA);
            ok.put("client", "PIPED");
            return ok;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
`;

const SPOTYFLOW_PLAYBACK_SERVICE_JAVA = `package com.spotyflow.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.PresetReverb;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.AuxEffectInfo;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class SpotyFlowPlaybackService extends MediaSessionService {
    public static final String CHANNEL_GENERAL = "spotyflow_general";
    public static final String CHANNEL_PLAYBACK = "spotyflow_playback";
    public static final String CHANNEL_MUSIC = "spotyflow_music";
    public static final String CHANNEL_DOWNLOADS = "spotyflow_downloads";

    private static final String DEFAULT_UA =
            "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

    public static volatile SpotyFlowPlaybackService instance = null;
    public static volatile boolean isPlaying = false;

    private static volatile PendingPlayRequest pendingPlayRequest = null;

    private ExoPlayer exoPlayer;
    private MediaSession mediaSession;
    private DefaultHttpDataSource.Factory httpDataSourceFactory;
    private Handler mainHandler;
    private ExecutorService artworkExecutor;

    // Hardware Audio FX instances (attached directly to ExoPlayer audioSessionId)
    private Equalizer nativeEqualizer;
    private BassBoost nativeBassBoost;
    private LoudnessEnhancer nativeLoudness;
    private PresetReverb nativeReverb;
    private int attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET;

    // Active FX parameters
    private final float[] currentEqGains = new float[] {0f, 0f, 0f, 0f, 0f};
    private int currentBoostPct = 100;
    private boolean currentNormalizer = false;
    private float currentReverbMix = 0f;
    private float currentSpeed = 1.0f;
    private boolean currentPreservesPitch = true;

    private String currentMediaId = "";
    private String lastArtworkUrl = "";
    private byte[] cachedArtworkBytes = null;

    public static class PendingPlayRequest {
        public final String url;
        public final String title;
        public final String artist;
        public final String album;
        public final String coverUrl;
        public final String userAgent;
        public final float volume;
        public final float speed;
        public final boolean preservesPitch;
        public final float[] eqGains;
        public final int boostPct;
        public final boolean normalizerEnabled;
        public final float reverbMix;

        public PendingPlayRequest(
                String url, String title, String artist, String album, String coverUrl,
                String userAgent, float volume, float speed, boolean preservesPitch,
                float[] eqGains, int boostPct, boolean normalizerEnabled, float reverbMix
        ) {
            this.url = url;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.coverUrl = coverUrl;
            this.userAgent = userAgent;
            this.volume = volume;
            this.speed = speed;
            this.preservesPitch = preservesPitch;
            this.eqGains = eqGains;
            this.boostPct = boostPct;
            this.normalizerEnabled = normalizerEnabled;
            this.reverbMix = reverbMix;
        }
    }

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

    public static void requestPlay(Context ctx, PendingPlayRequest req) {
        if (req == null) return;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> svc.playMediaInternal(req));
            return;
        }
        pendingPlayRequest = req;
        if (ctx != null) {
            try {
                ctx.startService(new Intent(ctx, SpotyFlowPlaybackService.class));
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

        // Configure Media3 Notification Provider using official Spotify-style Playback channel + white vector icon
        DefaultMediaNotificationProvider notificationProvider =
                new DefaultMediaNotificationProvider.Builder(this)
                        .setChannelId(CHANNEL_PLAYBACK)
                        .build();
        notificationProvider.setSmallIcon(R.drawable.ic_stat_music);
        setMediaNotificationProvider(notificationProvider);

        // Anti-stutter ExoPlayer LoadControl (20s min, 60s max, 1.2s start, 2.5s rebuffer)
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(20000, 60000, 1200, 2500)
                .build();

        httpDataSourceFactory = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(10000)
                .setReadTimeoutMs(15000)
                .setUserAgent(DEFAULT_UA);

        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpDataSourceFactory);
        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(dataSourceFactory);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();

        exoPlayer = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .setLoadControl(loadControl)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onAudioSessionIdChanged(int audioSessionId) {
                attachAudioEffects(audioSessionId);
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_BUFFERING) {
                    MainActivity.dispatchExoEvent("buffering", buildStateJson());
                } else if (playbackState == Player.STATE_READY) {
                    int sid = exoPlayer.getAudioSessionId();
                    if (sid != C.AUDIO_SESSION_ID_UNSET && sid != 0 && sid != attachedAudioSessionId) {
                        attachAudioEffects(sid);
                    }
                    MainActivity.dispatchExoEvent("ready", buildStateJson());
                } else if (playbackState == Player.STATE_ENDED) {
                    isPlaying = false;
                    MainActivity.dispatchExoEvent("ended", buildStateJson());
                }
            }

            @Override
            public void onIsPlayingChanged(boolean playing) {
                isPlaying = playing;
                MainActivity.dispatchExoEvent(playing ? "playing" : "paused", buildStateJson());
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                isPlaying = false;
                JSONObject extra = buildStateJson();
                try {
                    extra.put("message", error.getMessage() != null ? error.getMessage() : "ExoPlayer error");
                    extra.put("errorCode", error.errorCode);
                } catch (Exception ignored) {
                }
                MainActivity.dispatchExoEvent("error", extra);
            }
        });

        ForwardingPlayer forwardingPlayer = new ForwardingPlayer(exoPlayer) {
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
            public void seekToNext() {
                MainActivity.dispatchExoEvent("next", null);
            }

            @Override
            public void seekToNextMediaItem() {
                MainActivity.dispatchExoEvent("next", null);
            }

            @Override
            public void seekToPrevious() {
                if (getCurrentPosition() > 3000L) {
                    seekTo(0L);
                } else {
                    MainActivity.dispatchExoEvent("prev", null);
                }
            }

            @Override
            public void seekToPreviousMediaItem() {
                if (getCurrentPosition() > 3000L) {
                    seekTo(0L);
                } else {
                    MainActivity.dispatchExoEvent("prev", null);
                }
            }
        };

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
                this,
                100,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        mediaSession = new MediaSession.Builder(this, forwardingPlayer)
                .setSessionActivity(sessionActivity)
                .build();

        // Execute any play request queued while service was booting
        PendingPlayRequest queued = pendingPlayRequest;
        pendingPlayRequest = null;
        if (queued != null) {
            mainHandler.post(() -> playMediaInternal(queued));
        }
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        if (exoPlayer == null || !exoPlayer.getPlayWhenReady()) {
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
        releaseAudioEffects();
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
        if (exoPlayer != null) {
            try {
                exoPlayer.release();
            } catch (Exception ignored) {
            }
            exoPlayer = null;
        }
        super.onDestroy();
    }

    public JSONObject buildStateJson() {
        JSONObject obj = new JSONObject();
        try {
            long pos = exoPlayer != null ? Math.max(0L, exoPlayer.getCurrentPosition()) : 0L;
            long dur = exoPlayer != null ? Math.max(0L, exoPlayer.getDuration()) : 0L;
            if (dur == C.TIME_UNSET || dur < 0L) dur = 0L;
            obj.put("positionMs", pos);
            obj.put("durationMs", dur);
            obj.put("isPlaying", exoPlayer != null && exoPlayer.isPlaying());
        } catch (Exception ignored) {
        }
        return obj;
    }

    public void playMediaInternal(PendingPlayRequest req) {
        if (exoPlayer == null || req == null || req.url == null || req.url.isEmpty()) return;

        if (req.eqGains != null) {
            for (int i = 0; i < Math.min(5, req.eqGains.length); i++) {
                currentEqGains[i] = req.eqGains[i];
            }
        }
        currentBoostPct = req.boostPct;
        currentNormalizer = req.normalizerEnabled;
        currentReverbMix = req.reverbMix;
        currentSpeed = req.speed;
        currentPreservesPitch = req.preservesPitch;

        String effectiveUa = (req.userAgent != null && !req.userAgent.isEmpty()) ? req.userAgent : DEFAULT_UA;
        if (httpDataSourceFactory != null) {
            httpDataSourceFactory.setUserAgent(effectiveUa);
        }

        String safeTitle = (req.title != null && !req.title.isEmpty()) ? req.title : "SpotyFlow";
        String safeArtist = (req.artist != null && !req.artist.isEmpty()) ? req.artist : "SpotyFlow Studio";
        String safeAlbum = (req.album != null && !req.album.isEmpty()) ? req.album : "SpotyFlow";
        String safeCover = (req.coverUrl != null && req.coverUrl.startsWith("http"))
                ? req.coverUrl
                : "https://spotyflow.vercel.app/icon-512.png";

        currentMediaId = "sf_" + System.currentTimeMillis();

        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .setTitle(safeTitle)
                .setArtist(safeArtist)
                .setAlbumTitle(safeAlbum)
                .setDisplayTitle(safeTitle)
                .setSubtitle(safeArtist)
                .setArtworkUri(Uri.parse(safeCover));

        if (safeCover.equals(lastArtworkUrl) && cachedArtworkBytes != null && cachedArtworkBytes.length > 0) {
            metaBuilder.setArtworkData(cachedArtworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER);
        }

        MediaItem mediaItem = new MediaItem.Builder()
                .setMediaId(currentMediaId)
                .setUri(Uri.parse(req.url))
                .setMediaMetadata(metaBuilder.build())
                .build();

        exoPlayer.setVolume(Math.max(0f, Math.min(1f, req.volume)));
        applyPlaybackParams(currentSpeed, currentPreservesPitch);
        exoPlayer.setMediaItem(mediaItem);
        exoPlayer.prepare();
        exoPlayer.play();

        applyAllActiveHardwareEffects();
        fetchArtworkBytesAsync(currentMediaId, safeCover, safeTitle, safeArtist, safeAlbum);
    }

    private void fetchArtworkBytesAsync(
            final String mediaId,
            final String coverUrl,
            final String title,
            final String artist,
            final String album
    ) {
        if (coverUrl == null || !coverUrl.startsWith("http")) return;
        if (coverUrl.equals(lastArtworkUrl) && cachedArtworkBytes != null) return;
        if (artworkExecutor == null || artworkExecutor.isShutdown()) return;

        artworkExecutor.execute(() -> {
            HttpURLConnection conn = null;
            byte[] bytes = null;
            try {
                URL url = new URL(coverUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "SpotyFlow-Android/11.0");
                if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    try (InputStream is = conn.getInputStream();
                         ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        int total = 0;
                        while ((n = is.read(buf)) != -1) {
                            total += n;
                            if (total > 1500000) break; // Max 1.5 MB cover guard
                            bos.write(buf, 0, n);
                        }
                        if (bos.size() > 100) {
                            bytes = bos.toByteArray();
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }

            if (bytes != null && mainHandler != null) {
                final byte[] finalBytes = bytes;
                mainHandler.post(() -> {
                    lastArtworkUrl = coverUrl;
                    cachedArtworkBytes = finalBytes;
                    if (exoPlayer == null || !mediaId.equals(currentMediaId) || exoPlayer.getMediaItemCount() == 0) {
                        return;
                    }
                    try {
                        MediaItem cur = exoPlayer.getCurrentMediaItem();
                        if (cur != null && mediaId.equals(cur.mediaId)) {
                            MediaMetadata updatedMeta = new MediaMetadata.Builder()
                                    .setTitle(title)
                                    .setArtist(artist)
                                    .setAlbumTitle(album)
                                    .setDisplayTitle(title)
                                    .setSubtitle(artist)
                                    .setArtworkUri(Uri.parse(coverUrl))
                                    .setArtworkData(finalBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                                    .build();
                            exoPlayer.replaceMediaItem(
                                    exoPlayer.getCurrentMediaItemIndex(),
                                    cur.buildUpon().setMediaMetadata(updatedMeta).build()
                            );
                        }
                    } catch (Throwable ignored) {
                    }
                });
            }
        });
    }

    // ==================== HARDWARE DSP AUDIO FX (SAFE ANTI-CRASH) ====================

    private void attachAudioEffects(int audioSessionId) {
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId == 0) return;
        releaseAudioEffects();
        attachedAudioSessionId = audioSessionId;

        try {
            nativeEqualizer = new Equalizer(0, audioSessionId);
        } catch (Throwable ignored) {
            nativeEqualizer = null;
        }

        try {
            nativeBassBoost = new BassBoost(0, audioSessionId);
        } catch (Throwable ignored) {
            nativeBassBoost = null;
        }

        try {
            nativeLoudness = new LoudnessEnhancer(audioSessionId);
        } catch (Throwable ignored) {
            nativeLoudness = null;
        }

        try {
            nativeReverb = new PresetReverb(0, audioSessionId);
        } catch (Throwable ignored) {
            nativeReverb = null;
        }

        applyAllActiveHardwareEffects();
    }

    private void releaseAudioEffects() {
        attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET;
        if (exoPlayer != null) {
            try {
                exoPlayer.setAuxEffectInfo(new AuxEffectInfo(AuxEffectInfo.NO_AUX_EFFECT_ID, 0f));
            } catch (Throwable ignored) {
            }
        }
        if (nativeEqualizer != null) {
            try { nativeEqualizer.release(); } catch (Throwable ignored) {}
            nativeEqualizer = null;
        }
        if (nativeBassBoost != null) {
            try { nativeBassBoost.release(); } catch (Throwable ignored) {}
            nativeBassBoost = null;
        }
        if (nativeLoudness != null) {
            try { nativeLoudness.release(); } catch (Throwable ignored) {}
            nativeLoudness = null;
        }
        if (nativeReverb != null) {
            try { nativeReverb.release(); } catch (Throwable ignored) {}
            nativeReverb = null;
        }
    }

    private void applyAllActiveHardwareEffects() {
        applyEqBandsInternal();
        applyLoudnessBoostInternal();
        applyReverbMixInternal();
    }

    public void applyEqBands(float[] gains) {
        if (gains == null) return;
        for (int i = 0; i < Math.min(5, gains.length); i++) {
            currentEqGains[i] = Math.max(-12f, Math.min(12f, gains[i]));
        }
        applyEqBandsInternal();
    }

    private void applyEqBandsInternal() {
        boolean anyNonZero = false;
        for (float g : currentEqGains) {
            if (Math.abs(g) > 0.05f) {
                anyNonZero = true;
                break;
            }
        }

        if (nativeEqualizer != null) {
            try {
                short numBands = nativeEqualizer.getNumberOfBands();
                short[] range = nativeEqualizer.getBandLevelRange();
                short minMb = (range != null && range.length >= 2) ? range[0] : -1200;
                short maxMb = (range != null && range.length >= 2) ? range[1] : 1200;

                for (short b = 0; b < numBands; b++) {
                    int mappedIdx = numBands <= 1
                            ? 0
                            : Math.min(4, Math.round((b * 4f) / (numBands - 1f)));
                    int targetMb = Math.round(currentEqGains[mappedIdx] * 100f);
                    short clamped = (short) Math.max(minMb, Math.min(maxMb, targetMb));
                    nativeEqualizer.setBandLevel(b, clamped);
                }
                nativeEqualizer.setEnabled(anyNonZero);
            } catch (Throwable ignored) {
            }
        }

        if (nativeBassBoost != null) {
            try {
                float bassDb = currentEqGains[0];
                if (bassDb > 1.0f) {
                    short strength = (short) Math.max(0, Math.min(750, Math.round((bassDb / 12f) * 750f)));
                    if (nativeBassBoost.getStrengthSupported()) {
                        nativeBassBoost.setStrength(strength);
                    }
                    nativeBassBoost.setEnabled(true);
                } else {
                    if (nativeBassBoost.getStrengthSupported()) {
                        nativeBassBoost.setStrength((short) 0);
                    }
                    nativeBassBoost.setEnabled(false);
                }
            } catch (Throwable ignored) {
            }
        }
    }

    public void applyLoudnessBoost(int boostPct, boolean normalizerEnabled) {
        currentBoostPct = Math.max(100, Math.min(300, boostPct));
        currentNormalizer = normalizerEnabled;
        applyLoudnessBoostInternal();
    }

    private void applyLoudnessBoostInternal() {
        if (nativeLoudness == null) return;
        try {
            int gainMb = (currentNormalizer ? 250 : 0) + Math.max(0, (currentBoostPct - 100) * 5);
            gainMb = Math.max(0, Math.min(950, gainMb));
            nativeLoudness.setTargetGain(gainMb);
            nativeLoudness.setEnabled(gainMb > 0);
        } catch (Throwable ignored) {
        }
    }

    public void applyReverbMix(float mix01) {
        currentReverbMix = Math.max(0f, Math.min(1f, mix01));
        applyReverbMixInternal();
    }

    private void applyReverbMixInternal() {
        if (nativeReverb == null || exoPlayer == null) return;
        try {
            if (currentReverbMix >= 0.08f) {
                short preset;
                if (currentReverbMix < 0.25f) {
                    preset = PresetReverb.PRESET_SMALLROOM;
                } else if (currentReverbMix < 0.45f) {
                    preset = PresetReverb.PRESET_MEDIUMHALL;
                } else {
                    preset = PresetReverb.PRESET_LARGEHALL;
                }
                nativeReverb.setPreset(preset);
                nativeReverb.setEnabled(true);
                exoPlayer.setAuxEffectInfo(new AuxEffectInfo(nativeReverb.getId(), Math.min(1f, currentReverbMix)));
            } else {
                nativeReverb.setPreset(PresetReverb.PRESET_NONE);
                nativeReverb.setEnabled(false);
                exoPlayer.setAuxEffectInfo(new AuxEffectInfo(AuxEffectInfo.NO_AUX_EFFECT_ID, 0f));
            }
        } catch (Throwable ignored) {
        }
    }

    public void applyPlaybackParams(float speed, boolean preservesPitch) {
        currentSpeed = Math.max(0.5f, Math.min(2.0f, speed));
        currentPreservesPitch = preservesPitch;
        if (exoPlayer == null) return;
        try {
            float pitch = currentPreservesPitch ? 1.0f : currentSpeed;
            exoPlayer.setPlaybackParameters(new PlaybackParameters(currentSpeed, pitch));
        } catch (Throwable ignored) {
        }
    }

    // ==================== DIRECT PLAYER CONTROLS ====================

    public void pausePlayback() {
        if (exoPlayer != null) exoPlayer.pause();
    }

    public void resumePlayback() {
        if (exoPlayer != null) exoPlayer.play();
    }

    public void togglePlayback() {
        if (exoPlayer == null) return;
        if (exoPlayer.isPlaying()) exoPlayer.pause();
        else exoPlayer.play();
    }

    public void seekToMs(long positionMs) {
        if (exoPlayer != null) exoPlayer.seekTo(Math.max(0L, positionMs));
    }

    public void setPlayerVolume(float vol) {
        if (exoPlayer != null) exoPlayer.setVolume(Math.max(0f, Math.min(1f, vol)));
    }

    public void stopPlayback() {
        isPlaying = false;
        if (exoPlayer != null) {
            exoPlayer.stop();
            exoPlayer.clearMediaItems();
        }
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
    private boolean exoBridgeReady = false;

    public SpotyFlowWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    private void ensureExoBridgeBeforeLoad() {
        if (exoBridgeReady) return;
        exoBridgeReady = true;
        MainActivity.attachExoBridgeToWebView(this);
    }

    @Override
    public void loadUrl(String url) {
        ensureExoBridgeBeforeLoad();
        super.loadUrl(url);
    }

    @Override
    public void loadUrl(String url, Map<String, String> additionalHttpHeaders) {
        ensureExoBridgeBeforeLoad();
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

    <com.spotyflow.music.SpotyFlowWebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`;

const MAIN_ACTIVITY_JAVA = `package com.spotyflow.music;

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

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class MainActivity extends BridgeActivity {
    private static final int REQ_SPOTYFLOW_PERMISSIONS = 1001;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);

    private ExecutorService backgroundExecutor;
    private Handler mainHandler;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean bridgeAttached = false;
    private boolean appInForeground = true;

    private final Runnable timeUpdateTicker = new Runnable() {
        @Override
        public void run() {
            try {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null && SpotyFlowPlaybackService.isPlaying && appInForeground) {
                    dispatchExoEvent("timeupdate", svc.buildStateJson());
                }
            } catch (Exception ignored) {
            }
            if (mainHandler != null) {
                mainHandler.postDelayed(this, 500L);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        mainHandler = new Handler(Looper.getMainLooper());
        backgroundExecutor = Executors.newCachedThreadPool();

        // Buat 4 kategori notifikasi persis Spotify segera saat app dibuka
        SpotyFlowPlaybackService.ensureNotificationChannels(this);

        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            attachExoBridgeInstance(getBridge().getWebView());
        }

        connectMediaController();
        requestSpotifyLikePermissions();
        requestBatteryOptimizationExemptionOnce();
        handleDeepLinkIntent(getIntent());

        mainHandler.postDelayed(timeUpdateTicker, 500L);
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

    public static void attachExoBridgeToWebView(WebView webView) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act != null && webView != null) {
            act.attachExoBridgeInstance(webView);
        }
    }

    private void attachExoBridgeInstance(WebView webView) {
        if (bridgeAttached || webView == null) return;
        bridgeAttached = true;
        try {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            String ua = settings.getUserAgentString();
            if (ua == null) ua = "";
            if (!ua.contains("SpotyFlowApp/")) {
                settings.setUserAgentString(ua + " SpotyFlowApp/4.0");
            }
            webView.addJavascriptInterface(new SpotyFlowExoBridge(), "SpotyFlowExo");
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

    public static void dispatchExoEvent(final String type, final JSONObject payload) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || type == null) return;
        final JSONObject eventObj = payload != null ? payload : new JSONObject();
        try {
            eventObj.put("type", type);
        } catch (Exception ignored) {
        }
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "if(window.__sfOnExoEvent){window.__sfOnExoEvent(" + eventObj.toString() + ");}";
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
        appInForeground = true;
        activeInstance = new WeakReference<>(this);
        dispatchAppVisibilityToWebView(true);
        SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
        if (svc != null) {
            dispatchExoEvent("timeupdate", svc.buildStateJson());
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onStop() {
        appInForeground = false;
        dispatchAppVisibilityToWebView(false);
        super.onStop();
        scheduleBackgroundWebViewKeepAlive();
    }

    @Override
    public void onDestroy() {
        if (mainHandler != null) {
            mainHandler.removeCallbacks(timeUpdateTicker);
        }
        if (controllerFuture != null) {
            try {
                MediaController.releaseFuture(controllerFuture);
            } catch (Exception ignored) {
            }
            controllerFuture = null;
        }
        if (backgroundExecutor != null) {
            backgroundExecutor.shutdownNow();
            backgroundExecutor = null;
        }
        super.onDestroy();
    }

    private void scheduleBackgroundWebViewKeepAlive() {
        keepBackgroundAudioWebViewAlive();
        if (mainHandler != null) {
            mainHandler.postDelayed(this::keepBackgroundAudioWebViewAlive, 150L);
            mainHandler.postDelayed(this::keepBackgroundAudioWebViewAlive, 500L);
        }
    }

    private void keepBackgroundAudioWebViewAlive() {
        try {
            if (SpotyFlowPlaybackService.isPlaying && getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.onResume();
                webView.resumeTimers();
            }
        } catch (Exception ignored) {
        }
    }

    private class SpotyFlowExoBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void playTrack(final String jsonPayload) {
            if (backgroundExecutor == null || backgroundExecutor.isShutdown()) {
                backgroundExecutor = Executors.newCachedThreadPool();
            }
            backgroundExecutor.execute(() -> {
                try {
                    JSONObject obj = new JSONObject(jsonPayload != null ? jsonPayload : "{}");
                    String url = obj.optString("url", "").trim();
                    String videoId = obj.optString("videoId", "").trim();
                    String title = obj.optString("title", "SpotyFlow");
                    String artist = obj.optString("artist", "SpotyFlow Studio");
                    String album = obj.optString("album", "SpotyFlow");
                    String coverUrl = obj.optString("coverUrl", "https://spotyflow.vercel.app/icon-512.png");
                    float volume = (float) obj.optDouble("volume", 1.0);
                    float speed = (float) obj.optDouble("speed", 1.0);
                    boolean preservesPitch = obj.optBoolean("preservesPitch", true);
                    int boostPct = obj.optInt("boostPct", 100);
                    boolean normalizerEnabled = obj.optBoolean("normalizerEnabled", false);
                    float reverbMix = (float) obj.optDouble("reverbMix", 0.0);
                    String userAgent = obj.optString("userAgent", "");

                    float[] eqGains = new float[] {0f, 0f, 0f, 0f, 0f};
                    JSONArray eqArr = obj.optJSONArray("eqGains");
                    if (eqArr != null) {
                        for (int i = 0; i < Math.min(5, eqArr.length()); i++) {
                            eqGains[i] = (float) eqArr.optDouble(i, 0.0);
                        }
                    }

                    if (url.isEmpty() && !videoId.isEmpty()) {
                        JSONObject resolved = NativeYouTubeResolver.resolveAudioStream(videoId);
                        if (resolved != null && resolved.optBoolean("ok", false)) {
                            url = resolved.optString("url", "");
                            if (userAgent.isEmpty()) {
                                userAgent = resolved.optString("userAgent", "");
                            }
                        } else {
                            JSONObject err = new JSONObject();
                            err.put("message", resolved != null ? resolved.optString("error", "Resolve failed") : "Resolve failed");
                            dispatchExoEvent("error", err);
                            return;
                        }
                    }

                    if (url.isEmpty()) {
                        JSONObject err = new JSONObject();
                        err.put("message", "Empty audio URL");
                        dispatchExoEvent("error", err);
                        return;
                    }

                    SpotyFlowPlaybackService.PendingPlayRequest req =
                            new SpotyFlowPlaybackService.PendingPlayRequest(
                                    url, title, artist, album, coverUrl, userAgent,
                                    volume, speed, preservesPitch, eqGains,
                                    boostPct, normalizerEnabled, reverbMix
                            );
                    SpotyFlowPlaybackService.requestPlay(getApplicationContext(), req);
                } catch (Exception e) {
                    JSONObject err = new JSONObject();
                    try {
                        err.put("message", e.getMessage() != null ? e.getMessage() : "playTrack failed");
                    } catch (Exception ignored) {
                    }
                    dispatchExoEvent("error", err);
                }
            });
        }

        @JavascriptInterface
        public void pause() {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.pausePlayback();
            });
        }

        @JavascriptInterface
        public void resume() {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.resumePlayback();
            });
        }

        @JavascriptInterface
        public void toggle() {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.togglePlayback();
            });
        }

        @JavascriptInterface
        public void seekTo(final long positionMs) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.seekToMs(positionMs);
            });
        }

        @JavascriptInterface
        public void setVolume(final float vol) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.setPlayerVolume(vol);
            });
        }

        @JavascriptInterface
        public void setPlaybackRate(final float rate) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.applyPlaybackParams(rate, true);
            });
        }

        @JavascriptInterface
        public void setPlaybackParams(final float speed, final boolean preservesPitch) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.applyPlaybackParams(speed, preservesPitch);
            });
        }

        @JavascriptInterface
        public void setEqBands(final String jsonGains) {
            runOnUiThread(() -> {
                try {
                    JSONArray arr = new JSONArray(jsonGains != null ? jsonGains : "[]");
                    float[] gains = new float[] {0f, 0f, 0f, 0f, 0f};
                    for (int i = 0; i < Math.min(5, arr.length()); i++) {
                        gains[i] = (float) arr.optDouble(i, 0.0);
                    }
                    SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                    if (svc != null) svc.applyEqBands(gains);
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void setLoudnessAndBoost(final int boostPct, final boolean normalizerEnabled) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.applyLoudnessBoost(boostPct, normalizerEnabled);
            });
        }

        @JavascriptInterface
        public void setReverbMix(final float mix01) {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.applyReverbMix(mix01);
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null) svc.stopPlayback();
            });
        }

        @JavascriptInterface
        public void resolveFullAudioAsync(final String videoId, final String reqId) {
            if (backgroundExecutor == null || backgroundExecutor.isShutdown()) {
                backgroundExecutor = Executors.newCachedThreadPool();
            }
            backgroundExecutor.execute(() -> {
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

  // Add AndroidX Media3 1.4.1 + Guava dependencies
  const requiredDeps = [
    'implementation "androidx.media3:media3-exoplayer:1.4.1"',
    'implementation "androidx.media3:media3-session:1.4.1"',
    'implementation "androidx.media3:media3-common:1.4.1"',
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
  console.log('  + Patched android/app/build.gradle (Media3 1.4.1 + Guava + Java 17)');
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
  fs.mkdirSync(JAVA_PKG_DIR, { recursive: true });
  fs.mkdirSync(RES_LAYOUT_DIR, { recursive: true });
  fs.mkdirSync(RES_DRAWABLE_DIR, { recursive: true });

  // Clean up any legacy service/plugin Java files
  for (const legacy of ['SpotyFlowMediaService.java', 'SpotyFlowMediaPlugin.java']) {
    const p = path.join(JAVA_PKG_DIR, legacy);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'), NATIVE_YOUTUBE_RESOLVER_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), SPOTYFLOW_PLAYBACK_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), SPOTYFLOW_WEBVIEW_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), MAIN_ACTIVITY_JAVA, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'), IC_STAT_MUSIC_XML, 'utf8');

  console.log('  + Written NativeYouTubeResolver.java, SpotyFlowPlaybackService.java, SpotyFlowWebView.java, MainActivity.java, bridge_layout_main.xml, ic_stat_music.xml');
}

function verifyPatchedProject() {
  const mustExist = [
    BUILD_GRADLE,
    MANIFEST_XML,
    path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'),
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

  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const manifest = fs.readFileSync(MANIFEST_XML, 'utf8');
  const svc = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), 'utf8');
  const act = fs.readFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), 'utf8');
  const res = fs.readFileSync(path.join(JAVA_PKG_DIR, 'NativeYouTubeResolver.java'), 'utf8');

  const checks = [
    [gradle.includes('androidx.media3:media3-exoplayer:1.4.1'), 'build.gradle missing media3-exoplayer:1.4.1'],
    [gradle.includes('androidx.media3:media3-session:1.4.1'), 'build.gradle missing media3-session:1.4.1'],
    [gradle.includes('androidx.media3:media3-common:1.4.1'), 'build.gradle missing media3-common:1.4.1'],
    [gradle.includes('com.google.guava:guava:32.1.3-android'), 'build.gradle missing guava'],
    [gradle.includes('JavaVersion.VERSION_17'), 'build.gradle missing Java 17'],
    [manifest.includes('android:appCategory="audio"'), 'Manifest missing appCategory="audio"'],
    [manifest.includes('androidx.media3.session.MediaSessionService'), 'Manifest missing MediaSessionService'],
    [manifest.includes('androidx.media3.session.MediaButtonReceiver'), 'Manifest missing Media3 MediaButtonReceiver'],
    [!manifest.includes('SpotyFlowMediaService'), 'Manifest still has legacy SpotyFlowMediaService'],
    [!manifest.includes('SYSTEM_ALERT_WINDOW'), 'Manifest must NOT contain SYSTEM_ALERT_WINDOW'],
    [svc.includes('extends MediaSessionService') && svc.includes('@UnstableApi'), 'Service must extend MediaSessionService with @UnstableApi'],
    [svc.includes('Equalizer') && svc.includes('BassBoost') && svc.includes('LoudnessEnhancer') && svc.includes('PresetReverb'), 'Service missing hardware AudioFX classes'],
    [svc.includes('spotyflow_general') && svc.includes('spotyflow_playback') && svc.includes('spotyflow_music') && svc.includes('spotyflow_downloads'), 'Service missing 4 notification channels'],
    [act.includes('"SpotyFlowExo"') && act.includes('setEqBands') && act.includes('setLoudnessAndBoost') && act.includes('setReverbMix') && act.includes('setPlaybackParams'), 'MainActivity missing SpotyFlowExo bridge methods'],
    [res.includes('pipedapi.kavin.rocks') && res.includes('20.10.4'), 'NativeYouTubeResolver missing IOS or Piped fallback'],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED:', msg);
      process.exit(1);
    }
  }
  console.log('  + Strict self-verification passed (15/15 Media3 + Hardware DSP checks)');
}

function main() {
  try {
    if (!fs.existsSync(ANDROID_DIR)) {
      throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
    }
    console.log('[SpotyFlow Media3 Patcher] Injecting AndroidX Media3 ExoPlayer + Hardware DSP Audio FX...');
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
