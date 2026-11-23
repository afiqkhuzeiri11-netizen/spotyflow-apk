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
const ROOT_BUILD_GRADLE = path.join(ANDROID_DIR, 'build.gradle');
const SETTINGS_GRADLE = path.join(ANDROID_DIR, 'settings.gradle');
const VARIABLES_GRADLE = path.join(ANDROID_DIR, 'variables.gradle');
const APP_DIR = path.join(ANDROID_DIR, 'app');
const BUILD_GRADLE = path.join(APP_DIR, 'build.gradle');
const MANIFEST_XML = path.join(APP_DIR, 'src', 'main', 'AndroidManifest.xml');
const JAVA_ROOT_DIR = path.join(APP_DIR, 'src', 'main', 'java');
const RES_LAYOUT_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'layout');
const RES_DRAWABLE_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'drawable');
const RES_XML_DIR = path.join(APP_DIR, 'src', 'main', 'res', 'xml');

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

const WIDGET_BG_DARK_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#CC12141C" />
    <corners android:radius="22dp" />
    <stroke
        android:width="1dp"
        android:color="#38FFFFFF" />
</shape>
`;

const WIDGET_BG_ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
    <corners android:radius="22dp" />
</shape>
`;

const WIDGET_BG_STROKE_OVERLAY_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#26000000" />
    <corners android:radius="22dp" />
    <stroke
        android:width="1dp"
        android:color="#38FFFFFF" />
</shape>
`;

const WIDGET_COVER_BG_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#242424" />
    <corners android:radius="12dp" />
</shape>
`;

const WIDGET_BTN_PLAY_BG_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#FFFFFF" />
</shape>
`;

const IC_WIDGET_PREV_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M6,6h2v12H6V6zM9.5,12l8.5,6V6L9.5,12z" />
</vector>
`;

const IC_WIDGET_NEXT_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z" />
</vector>
`;

const IC_WIDGET_PLAY_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#000000"
        android:pathData="M8,5v14l11,-7L8,5z" />
</vector>
`;

const IC_WIDGET_PAUSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#000000"
        android:pathData="M6,19h4V5H6v14zM14,5v14h4V5h-4z" />
</vector>
`;

const WIDGET_SPOTYFLOW_SMALL_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg_dark"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:paddingLeft="12dp"
    android:paddingTop="8dp"
    android:paddingRight="12dp"
    android:paddingBottom="8dp">

    <ImageView
        android:id="@+id/widget_cover"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="@drawable/widget_cover_bg"
        android:contentDescription="Sampul Lagu"
        android:scaleType="centerCrop"
        android:src="@drawable/ic_stat_music" />

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginLeft="10dp"
        android:layout_marginRight="8dp"
        android:layout_weight="1"
        android:orientation="vertical">

        <TextView
            android:id="@+id/widget_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            android:text="SpotyFlow"
            android:textColor="#FFFFFF"
            android:textSize="14sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/widget_artist"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="2dp"
            android:ellipsize="end"
            android:maxLines="1"
            android:text="Ketuk untuk memutar musik"
            android:textColor="#B3FFFFFF"
            android:textSize="12sp" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal">

        <ImageButton
            android:id="@+id/widget_btn_prev"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:background="@android:color/transparent"
            android:contentDescription="Sebelumnya"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:src="@drawable/ic_widget_prev" />

        <ImageButton
            android:id="@+id/widget_btn_play_pause"
            android:layout_width="38dp"
            android:layout_height="38dp"
            android:layout_marginLeft="4dp"
            android:layout_marginRight="4dp"
            android:background="@drawable/widget_btn_play_bg"
            android:contentDescription="Putar atau Jeda"
            android:padding="8dp"
            android:scaleType="fitCenter"
            android:src="@drawable/ic_widget_play" />

        <ImageButton
            android:id="@+id/widget_btn_next"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:background="@android:color/transparent"
            android:contentDescription="Berikutnya"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:src="@drawable/ic_widget_next" />
    </LinearLayout>

</LinearLayout>
`;

const WIDGET_SPOTYFLOW_LARGE_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_tint"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:contentDescription=""
        android:scaleType="fitXY"
        android:src="@drawable/widget_bg_adaptive" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@drawable/widget_bg_stroke_overlay"
        android:gravity="center_vertical"
        android:orientation="vertical"
        android:padding="14dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="72dp"
                android:layout_height="72dp"
                android:background="@drawable/widget_cover_bg"
                android:contentDescription="Sampul Lagu"
                android:scaleType="centerCrop"
                android:src="@drawable/ic_stat_music" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_marginLeft="12dp"
                android:layout_weight="1"
                android:orientation="vertical">

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:letterSpacing="0.14"
                    android:text="SPOTYFLOW"
                    android:textColor="#1ED760"
                    android:textSize="10sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/widget_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="2dp"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:text="SpotyFlow"
                    android:textColor="#FFFFFF"
                    android:textSize="16sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="2dp"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:text="Ketuk untuk memutar musik"
                    android:textColor="#CCFFFFFF"
                    android:textSize="13sp" />
            </LinearLayout>
        </LinearLayout>

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:gravity="center"
            android:orientation="horizontal">

            <ImageButton
                android:id="@+id/widget_btn_prev"
                android:layout_width="42dp"
                android:layout_height="42dp"
                android:background="@android:color/transparent"
                android:contentDescription="Sebelumnya"
                android:padding="7dp"
                android:scaleType="fitCenter"
                android:src="@drawable/ic_widget_prev" />

            <ImageButton
                android:id="@+id/widget_btn_play_pause"
                android:layout_width="46dp"
                android:layout_height="46dp"
                android:layout_marginLeft="20dp"
                android:layout_marginRight="20dp"
                android:background="@drawable/widget_btn_play_bg"
                android:contentDescription="Putar atau Jeda"
                android:padding="10dp"
                android:scaleType="fitCenter"
                android:src="@drawable/ic_widget_play" />

            <ImageButton
                android:id="@+id/widget_btn_next"
                android:layout_width="42dp"
                android:layout_height="42dp"
                android:background="@android:color/transparent"
                android:contentDescription="Berikutnya"
                android:padding="7dp"
                android:scaleType="fitCenter"
                android:src="@drawable/ic_widget_next" />
        </LinearLayout>

    </LinearLayout>
</FrameLayout>
`;

const WIDGET_SPOTYFLOW_LYRICS_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_tint"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:contentDescription=""
        android:scaleType="fitXY"
        android:src="@drawable/widget_bg_adaptive" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@drawable/widget_bg_stroke_overlay"
        android:orientation="vertical"
        android:padding="14dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="42dp"
                android:layout_height="42dp"
                android:background="@drawable/widget_cover_bg"
                android:contentDescription="Sampul Lagu"
                android:scaleType="centerCrop"
                android:src="@drawable/ic_stat_music" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_marginLeft="10dp"
                android:layout_marginRight="8dp"
                android:layout_weight="1"
                android:orientation="vertical">

                <TextView
                    android:id="@+id/widget_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:text="SpotyFlow"
                    android:textColor="#FFFFFF"
                    android:textSize="13sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:text="Live Lyrics"
                    android:textColor="#B3FFFFFF"
                    android:textSize="11sp" />
            </LinearLayout>

            <ImageButton
                android:id="@+id/widget_btn_play_pause"
                android:layout_width="36dp"
                android:layout_height="36dp"
                android:background="@drawable/widget_btn_play_bg"
                android:contentDescription="Putar atau Jeda"
                android:padding="8dp"
                android:scaleType="fitCenter"
                android:src="@drawable/ic_widget_play" />

            <ImageButton
                android:id="@+id/widget_btn_next"
                android:layout_width="34dp"
                android:layout_height="34dp"
                android:layout_marginLeft="6dp"
                android:background="@android:color/transparent"
                android:contentDescription="Berikutnya"
                android:padding="5dp"
                android:scaleType="fitCenter"
                android:src="@drawable/ic_widget_next" />
        </LinearLayout>

        <TextView
            android:id="@+id/widget_live_lyric"
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_marginTop="10dp"
            android:layout_weight="1"
            android:ellipsize="end"
            android:gravity="center_vertical"
            android:lineSpacingExtra="2dp"
            android:maxLines="2"
            android:text="♪ Lirik aktif akan muncul di sini"
            android:textColor="#FFFFFF"
            android:textSize="15sp"
            android:textStyle="bold" />

    </LinearLayout>
</FrameLayout>
`;

const WIDGET_SPOTYFLOW_SMALL_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:initialLayout="@layout/widget_spotyflow_small"
    android:minWidth="250dp"
    android:minHeight="56dp"
    android:resizeMode="horizontal"
    android:targetCellWidth="4"
    android:targetCellHeight="1"
    android:updatePeriodMillis="0"
    android:widgetCategory="home_screen"
    tools:targetApi="s" />
`;

const WIDGET_SPOTYFLOW_LARGE_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:initialLayout="@layout/widget_spotyflow_large"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:resizeMode="horizontal|vertical"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:updatePeriodMillis="0"
    android:widgetCategory="home_screen"
    tools:targetApi="s" />
`;

const WIDGET_SPOTYFLOW_LYRICS_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:initialLayout="@layout/widget_spotyflow_lyrics"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:resizeMode="horizontal|vertical"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:updatePeriodMillis="0"
    android:widgetCategory="home_screen"
    tools:targetApi="s" />
`;

const SPOTYFLOW_WIDGET_PROVIDER_JAVA = `package ${APP_ID};

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.widget.RemoteViews;

import androidx.media3.common.util.UnstableApi;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class SpotyFlowWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_WIDGET_CMD = "${APP_ID}.WIDGET_CMD";
    public static final String EXTRA_CMD = "cmd";
    private static final ExecutorService WIDGET_EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile long lastFullUpdateMs = 0L;

    protected int getWidgetLayoutResId() {
        return R.layout.widget_spotyflow_small;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) return;
        for (int widgetId : appWidgetIds) {
            try {
                RemoteViews views = buildRemoteViews(context, getWidgetLayoutResId());
                appWidgetManager.updateAppWidget(widgetId, views);
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (context == null || intent == null) return;
        if (ACTION_WIDGET_CMD.equals(intent.getAction())) {
            String cmd = intent.getStringExtra(EXTRA_CMD);
            if ("play_pause".equals(cmd) && SpotyFlowPlaybackService.isNativeExoActive()) {
                String action = SpotyFlowPlaybackService.isPlaying ? "pause" : "play";
                SpotyFlowPlaybackService.dispatchNativeControl(context, action, 0L);
                MainActivity.sendMediaActionToJs(action, 0L);
                updateAllWidgets(context);
                return;
            }
            if (!MainActivity.hasActiveWebView()) {
                try {
                    Intent launch = new Intent(context, MainActivity.class);
                    launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    context.startActivity(launch);
                } catch (Throwable ignored) {
                }
                return;
            }
            if ("prev".equals(cmd)) {
                MainActivity.sendMediaActionToJs("prev", 0L);
            } else if ("next".equals(cmd)) {
                MainActivity.sendMediaActionToJs("next", 0L);
            } else if ("play_pause".equals(cmd)) {
                String action = SpotyFlowPlaybackService.isPlaying ? "pause" : "play";
                MainActivity.sendMediaActionToJs(action, 0L);
            }
            updateAllWidgets(context);
        }
    }

    public static void updateAllWidgets(final Context context) {
        if (context == null) return;
        final long now = SystemClock.elapsedRealtime();
        if (now - lastFullUpdateMs < 350L) {
            return;
        }
        lastFullUpdateMs = now;
        final Context appCtx = context.getApplicationContext();
        WIDGET_EXECUTOR.execute(() -> {
            try {
                AppWidgetManager mgr = AppWidgetManager.getInstance(appCtx);
                if (mgr == null) return;

                int[] smallIds = mgr.getAppWidgetIds(new ComponentName(appCtx, SpotyFlowWidgetProvider.class));
                if (smallIds != null && smallIds.length > 0) {
                    RemoteViews smallViews = buildRemoteViews(appCtx, R.layout.widget_spotyflow_small);
                    mgr.updateAppWidget(smallIds, smallViews);
                }

                int[] largeIds = mgr.getAppWidgetIds(new ComponentName(appCtx, SpotyFlowWidgetLargeProvider.class));
                if (largeIds != null && largeIds.length > 0) {
                    RemoteViews largeViews = buildRemoteViews(appCtx, R.layout.widget_spotyflow_large);
                    mgr.updateAppWidget(largeIds, largeViews);
                }

                int[] lyricIds = mgr.getAppWidgetIds(new ComponentName(appCtx, SpotyFlowWidgetLyricsProvider.class));
                if (lyricIds != null && lyricIds.length > 0) {
                    RemoteViews lyricViews = buildRemoteViews(appCtx, R.layout.widget_spotyflow_lyrics);
                    mgr.updateAppWidget(lyricIds, lyricViews);
                }
            } catch (Throwable ignored) {
            }
        });
    }

    /**
     * SpotyFlow v2.0.2 Anti-Lag: HANYA perbarui TextView lirik pada Widget Lirik
     * TANPA mengirim ulang Bitmap sampul lewat Binder IPC!
     */
    public static void updateLyricsWidgetsOnly(final Context context) {
        if (context == null) return;
        final Context appCtx = context.getApplicationContext();
        WIDGET_EXECUTOR.execute(() -> {
            try {
                AppWidgetManager mgr = AppWidgetManager.getInstance(appCtx);
                if (mgr == null) return;
                int[] lyricIds = mgr.getAppWidgetIds(new ComponentName(appCtx, SpotyFlowWidgetLyricsProvider.class));
                if (lyricIds == null || lyricIds.length == 0) return;

                RemoteViews views = new RemoteViews(appCtx.getPackageName(), R.layout.widget_spotyflow_lyrics);
                String lyric = SpotyFlowPlaybackService.currentLyricLine;
                if (lyric == null || lyric.isEmpty()) {
                    String artist = SpotyFlowPlaybackService.lastWidgetArtist;
                    lyric = (artist != null && !artist.isEmpty()) ? ("♪ " + artist) : "Lirik sinkron tampil di sini...";
                }
                views.setTextViewText(R.id.widget_live_lyric, lyric);
                mgr.partiallyUpdateAppWidget(lyricIds, views);
            } catch (Throwable ignored) {
            }
        });
    }

    private static RemoteViews buildRemoteViews(Context context, int layoutResId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layoutResId);

        String title = SpotyFlowPlaybackService.lastWidgetTitle;
        if (title == null || title.isEmpty()) title = "SpotyFlow";
        String artist = SpotyFlowPlaybackService.lastWidgetArtist;
        if (artist == null || artist.isEmpty()) artist = "Ketuk untuk memutar musik";

        views.setTextViewText(R.id.widget_title, title);
        views.setTextViewText(R.id.widget_artist, artist);
        views.setImageViewResource(
                R.id.widget_btn_play_pause,
                SpotyFlowPlaybackService.isPlaying ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play
        );

        Bitmap cover = SpotyFlowPlaybackService.lastWidgetBitmap;
        if (cover != null && !cover.isRecycled()) {
            views.setImageViewBitmap(R.id.widget_cover, cover);
        } else {
            views.setImageViewResource(R.id.widget_cover, R.drawable.ic_stat_music);
        }

        if (layoutResId == R.layout.widget_spotyflow_large || layoutResId == R.layout.widget_spotyflow_lyrics) {
            try {
                views.setInt(R.id.widget_bg_tint, "setColorFilter", SpotyFlowPlaybackService.dominantColorInt);
            } catch (Throwable ignored) {
            }
        }

        if (layoutResId == R.layout.widget_spotyflow_lyrics) {
            String line = SpotyFlowPlaybackService.currentLyricLine;
            if (line == null || line.trim().isEmpty()) {
                views.setTextViewText(R.id.widget_live_lyric, "♪ Lirik aktif akan muncul di sini");
            } else {
                views.setTextViewText(R.id.widget_live_lyric, "♪ " + line.trim());
            }
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
                context,
                200,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, openPi);

        if (layoutResId != R.layout.widget_spotyflow_lyrics) {
            views.setOnClickPendingIntent(R.id.widget_btn_prev, buildCmdPendingIntent(context, "prev", 201));
        }
        views.setOnClickPendingIntent(R.id.widget_btn_play_pause, buildCmdPendingIntent(context, "play_pause", 202));
        views.setOnClickPendingIntent(R.id.widget_btn_next, buildCmdPendingIntent(context, "next", 203));

        return views;
    }

    private static PendingIntent buildCmdPendingIntent(Context context, String cmd, int requestCode) {
        Intent intent = new Intent(context, SpotyFlowWidgetProvider.class);
        intent.setAction(ACTION_WIDGET_CMD);
        intent.putExtra(EXTRA_CMD, cmd);
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
`;

const SPOTYFLOW_WIDGET_LARGE_PROVIDER_JAVA = `package ${APP_ID};

import androidx.media3.common.util.UnstableApi;

@UnstableApi
public class SpotyFlowWidgetLargeProvider extends SpotyFlowWidgetProvider {
    @Override
    protected int getWidgetLayoutResId() {
        return R.layout.widget_spotyflow_large;
    }
}
`;

const SPOTYFLOW_WIDGET_LYRICS_PROVIDER_JAVA = `package ${APP_ID};

import androidx.media3.common.util.UnstableApi;

@UnstableApi
public class SpotyFlowWidgetLyricsProvider extends SpotyFlowWidgetProvider {
    @Override
    protected int getWidgetLayoutResId() {
        return R.layout.widget_spotyflow_lyrics;
    }
}
`;

const SPOTYFLOW_NEWPIPE_ENGINE_JAVA = `package ${APP_ID};

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamExtractor;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SpotyFlowNewPipeEngine {
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
    private static final long CACHE_TTL_MS = 150L * 60L * 1000L;
    private static final int MAX_CACHE_ENTRIES = 60;

    private static volatile boolean initialized = false;
    private static final ExecutorService executor = Executors.newFixedThreadPool(4);
    private static final ConcurrentHashMap<String, CachedStream> streamCache = new ConcurrentHashMap<>();

    public static class StreamResult {
        public final boolean ok;
        public final String streamUrl;
        public final String mimeType;
        public final long durationSec;
        public final String title;
        public final String artist;
        public final boolean isOffline;
        public final String error;

        public StreamResult(boolean ok, String streamUrl, String mimeType, long durationSec, String title, String artist, boolean isOffline, String error) {
            this.ok = ok;
            this.streamUrl = streamUrl;
            this.mimeType = mimeType;
            this.durationSec = durationSec;
            this.title = title;
            this.artist = artist;
            this.isOffline = isOffline;
            this.error = error;
        }
    }

    public interface OfflineCallback {
        void onProgress(String trackId, int percent, String status);
    }

    private static class CachedStream {
        final String url;
        final String mimeType;
        final long durationSec;
        final String title;
        final String artist;
        final long expiresAtMs;

        CachedStream(String url, String mimeType, long durationSec, String title, String artist, long expiresAtMs) {
            this.url = url;
            this.mimeType = mimeType;
            this.durationSec = durationSec;
            this.title = title;
            this.artist = artist;
            this.expiresAtMs = expiresAtMs;
        }
    }

    private static class SimpleHttpDownloader extends Downloader {
        @Override
        public Response execute(Request request) throws IOException, ReCaptchaException {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(request.url());
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(9000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestMethod(request.httpMethod());
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9,id;q=0.8");

                Map<String, List<String>> reqHeaders = request.headers();
                if (reqHeaders != null) {
                    for (Map.Entry<String, List<String>> entry : reqHeaders.entrySet()) {
                        String key = entry.getKey();
                        List<String> values = entry.getValue();
                        if (key == null || values == null || values.isEmpty()) continue;
                        if (values.size() == 1) {
                            conn.setRequestProperty(key, values.get(0));
                        } else {
                            StringBuilder joined = new StringBuilder();
                            for (int i = 0; i < values.size(); i++) {
                                if (i > 0) joined.append(", ");
                                joined.append(values.get(i));
                            }
                            conn.setRequestProperty(key, joined.toString());
                        }
                    }
                }

                byte[] bodyBytes = request.dataToSend();
                if (bodyBytes != null && bodyBytes.length > 0) {
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bodyBytes);
                        os.flush();
                    }
                }

                int code = conn.getResponseCode();
                if (code == 429) {
                    throw new ReCaptchaException("reCaptcha Challenge requested", request.url());
                }

                String msg = conn.getResponseMessage();
                if (msg == null) msg = "";

                InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String respBody = "";
                if (stream != null) {
                    try (InputStream is = stream;
                         ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = is.read(buf)) != -1) {
                            bos.write(buf, 0, n);
                        }
                        respBody = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                    }
                }

                Map<String, List<String>> cleanHeaders = new HashMap<>();
                Map<String, List<String>> rawHeaders = conn.getHeaderFields();
                if (rawHeaders != null) {
                    for (Map.Entry<String, List<String>> entry : rawHeaders.entrySet()) {
                        if (entry.getKey() != null && entry.getValue() != null) {
                            cleanHeaders.put(entry.getKey(), entry.getValue());
                        }
                    }
                }

                String latestUrl = conn.getURL() != null ? conn.getURL().toString() : request.url();
                return new Response(code, msg, cleanHeaders, respBody, latestUrl);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }
    }

    public static synchronized void ensureInit() {
        if (initialized) return;
        NewPipe.init(new SimpleHttpDownloader());
        initialized = true;
    }

    public static ExecutorService getExecutor() {
        return executor;
    }

    public static String sanitizeId(String raw) {
        if (raw == null || raw.isEmpty()) return "track";
        return raw.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    public static File getOfflineAudioFile(Context ctx, String trackId) {
        File dir = new File(ctx.getFilesDir(), "offline_audio");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return new File(dir, sanitizeId(trackId) + ".m4a");
    }

    public static boolean hasOfflineTrack(Context ctx, String trackId) {
        if (ctx == null || trackId == null || trackId.isEmpty()) return false;
        try {
            File f = getOfflineAudioFile(ctx, trackId);
            return f.exists() && f.length() > 32768L;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean deleteOfflineTrack(Context ctx, String trackId) {
        if (ctx == null || trackId == null || trackId.isEmpty()) return false;
        try {
            File f = getOfflineAudioFile(ctx, trackId);
            return !f.exists() || f.delete();
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static String getOfflineTracksJson(Context ctx) {
        JSONArray arr = new JSONArray();
        if (ctx == null) return arr.toString();
        try {
            File dir = new File(ctx.getFilesDir(), "offline_audio");
            File[] files = dir.exists() ? dir.listFiles() : null;
            if (files != null) {
                for (File f : files) {
                    if (f != null && f.isFile() && f.getName().endsWith(".m4a") && f.length() > 32768L) {
                        String id = f.getName().substring(0, f.getName().length() - 4);
                        arr.put(id);
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return arr.toString();
    }

    public static StreamResult resolveAudioStream(Context ctx, String trackId, String videoId, boolean dataSaver) {
        if (ctx != null && trackId != null && !trackId.isEmpty()) {
            File offlineFile = getOfflineAudioFile(ctx, trackId);
            if (offlineFile.exists() && offlineFile.length() > 32768L) {
                return new StreamResult(true, Uri.fromFile(offlineFile).toString(), "audio/mp4", 0L, "", "", true, "");
            }
        }
        if (videoId == null || !videoId.matches("^[a-zA-Z0-9_-]{11}$")) {
            return new StreamResult(false, "", "", 0L, "", "", false, "Invalid YouTube videoId");
        }

        String cacheKey = videoId + ":" + (dataSaver ? "1" : "0");
        CachedStream cached = streamCache.get(cacheKey);
        long now = System.currentTimeMillis();
        if (cached != null && cached.expiresAtMs > now && cached.url != null && !cached.url.isEmpty()) {
            return new StreamResult(true, cached.url, cached.mimeType, cached.durationSec, cached.title, cached.artist, false, "");
        }

        try {
            ensureInit();
            StreamExtractor extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=" + videoId);
            extractor.fetchPage();
            List<AudioStream> streams = extractor.getAudioStreams();
            AudioStream best = pickBestAudioStream(streams, dataSaver, false);
            if (best == null || best.getContent() == null || best.getContent().isEmpty()) {
                return new StreamResult(false, "", "", 0L, "", "", false, "No audio streams available");
            }
            String streamUrl = best.getContent();
            MediaFormat fmt = best.getFormat();
            String mime = (fmt != null && fmt.getMimeType() != null) ? fmt.getMimeType() : "audio/mp4";
            long durSec = Math.max(0L, extractor.getLength());
            String title = extractor.getName() != null ? extractor.getName() : "";
            String artist = extractor.getUploaderName() != null ? extractor.getUploaderName() : "";

            if (streamCache.size() >= MAX_CACHE_ENTRIES) {
                streamCache.clear();
            }
            streamCache.put(cacheKey, new CachedStream(streamUrl, mime, durSec, title, artist, now + CACHE_TTL_MS));
            return new StreamResult(true, streamUrl, mime, durSec, title, artist, false, "");
        } catch (Throwable t) {
            return new StreamResult(false, "", "", 0L, "", "", false, t.getMessage() != null ? t.getMessage() : "Extract failed");
        }
    }

    private static AudioStream pickBestAudioStream(List<AudioStream> streams, boolean dataSaver, boolean preferM4aOnly) {
        if (streams == null || streams.isEmpty()) return null;
        AudioStream best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AudioStream s : streams) {
            if (s == null) continue;
            String content = s.getContent();
            if (content == null || content.isEmpty() || !content.startsWith("http")) continue;
            int br = Math.max(0, s.getAverageBitrate());
            MediaFormat fmt = s.getFormat();
            String suffix = (fmt != null && fmt.getSuffix() != null) ? fmt.getSuffix().toLowerCase() : "";
            boolean isM4a = "m4a".equals(suffix) || "mp4".equals(suffix);
            boolean isOpus = "webm".equals(suffix) || "opus".equals(suffix);
            if (preferM4aOnly && !isM4a) continue;

            int score = 0;
            if (dataSaver) {
                if (br >= 64 && br <= 128) score += 200;
                else if (br > 0 && br < 64) score += 120;
                else score += Math.max(0, 150 - Math.abs(br - 96));
                if (isM4a) score += 40;
                else if (isOpus) score += 25;
            } else {
                score += Math.min(br, 256);
                if (isM4a && br >= 120) score += 90;
                else if (isOpus && br >= 120) score += 75;
                else if (isM4a) score += 40;
            }
            if (score > bestScore) {
                bestScore = score;
                best = s;
            }
        }
        if (best == null && preferM4aOnly) {
            return pickBestAudioStream(streams, dataSaver, false);
        }
        return best;
    }

    public static void prefetchAsync(final Context ctx, final String videoId, final boolean dataSaver) {
        if (videoId == null || !videoId.matches("^[a-zA-Z0-9_-]{11}$")) return;
        String cacheKey = videoId + ":" + (dataSaver ? "1" : "0");
        CachedStream existing = streamCache.get(cacheKey);
        if (existing != null && existing.expiresAtMs > System.currentTimeMillis()) return;
        executor.execute(() -> {
            try {
                resolveAudioStream(ctx, "", videoId, dataSaver);
            } catch (Throwable ignored) {
            }
        });
    }

    public static void downloadOfflineAsync(final Context ctx, final String trackId, final String videoId, final OfflineCallback cb) {
        if (ctx == null || trackId == null || trackId.isEmpty() || videoId == null || !videoId.matches("^[a-zA-Z0-9_-]{11}$")) {
            if (cb != null) cb.onProgress(trackId != null ? trackId : "", 0, "error");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            File tmpFile = null;
            try {
                if (cb != null) cb.onProgress(trackId, 2, "resolving");
                ensureInit();
                StreamExtractor extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=" + videoId);
                extractor.fetchPage();
                AudioStream best = pickBestAudioStream(extractor.getAudioStreams(), false, true);
                if (best == null || best.getContent() == null || best.getContent().isEmpty()) {
                    if (cb != null) cb.onProgress(trackId, 0, "error");
                    return;
                }
                File outFile = getOfflineAudioFile(ctx, trackId);
                tmpFile = new File(outFile.getParentFile(), outFile.getName() + ".tmp");

                URL url = new URL(best.getContent());
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    if (cb != null) cb.onProgress(trackId, 0, "error");
                    return;
                }
                long totalLen = conn.getContentLengthLong();
                long written = 0L;
                int lastPct = 5;
                if (cb != null) cb.onProgress(trackId, 5, "downloading");

                try (InputStream is = conn.getInputStream();
                     FileOutputStream fos = new FileOutputStream(tmpFile)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        fos.write(buf, 0, n);
                        written += n;
                        if (totalLen > 0L && cb != null) {
                            int pct = (int) Math.min(99L, Math.max(5L, (written * 100L) / totalLen));
                            if (pct >= lastPct + 4) {
                                lastPct = pct;
                                cb.onProgress(trackId, pct, "downloading");
                            }
                        }
                    }
                    fos.flush();
                }

                if (written > 32768L) {
                    if (outFile.exists()) outFile.delete();
                    if (!tmpFile.renameTo(outFile)) {
                        tmpFile.delete();
                        if (cb != null) cb.onProgress(trackId, 0, "error");
                        return;
                    }
                    if (cb != null) cb.onProgress(trackId, 100, "done");
                } else {
                    if (tmpFile.exists()) tmpFile.delete();
                    if (cb != null) cb.onProgress(trackId, 0, "error");
                }
            } catch (Throwable ignored) {
                try {
                    if (tmpFile != null && tmpFile.exists()) tmpFile.delete();
                } catch (Throwable ignored2) {
                }
                if (cb != null) cb.onProgress(trackId, 0, "error");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }
}
`;

const SPOTYFLOW_FAST_RESOLVER_JAVA = `package ${APP_ID};

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SpotyFlowFastResolver {
    public static final String ANDROID_VR_USER_AGENT =
            "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)";
    private static final String WEB_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

    private static final long STREAM_CACHE_TTL_MS = 150L * 60L * 1000L; // 2.5 jam
    private static final int MAX_VIDEO_ID_CACHE = 200;
    private static final int MAX_STREAM_CACHE = 80;

    private static final ExecutorService fastExecutor = Executors.newFixedThreadPool(4);
    private static final ConcurrentHashMap<String, String> videoIdCache = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, FastStream> streamCache = new ConcurrentHashMap<>();

    public static class FastStream {
        public final boolean ok;
        public final String url;
        public final String userAgent;
        public final String mimeType;
        public final long durationSec;
        public final String engineTag;
        public final boolean isOffline;
        public final long expiresAtMs;
        public final String error;

        public FastStream(boolean ok, String url, String userAgent, String mimeType, long durationSec,
                          String engineTag, boolean isOffline, long expiresAtMs, String error) {
            this.ok = ok;
            this.url = url;
            this.userAgent = userAgent;
            this.mimeType = mimeType;
            this.durationSec = durationSec;
            this.engineTag = engineTag;
            this.isOffline = isOffline;
            this.expiresAtMs = expiresAtMs;
            this.error = error;
        }
    }

    public static ExecutorService getExecutor() {
        return fastExecutor;
    }

    private static String normalizeLookupKey(String title, String artist) {
        String t = title == null ? "" : title.trim().toLowerCase().replaceAll("\\\\s+", " ");
        String a = artist == null ? "" : artist.trim().toLowerCase().replaceAll("\\\\s+", " ");
        return t + "|" + a;
    }

    public static boolean isValidVideoId(String id) {
        return id != null && id.matches("^[a-zA-Z0-9_-]{11}$");
    }

    public static void invalidateStream(String videoId) {
        if (videoId == null || videoId.isEmpty()) return;
        streamCache.remove(videoId + "_hi");
        streamCache.remove(videoId + "_low");
    }

    public static void warmUpAsync() {
        fastExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL("https://music.youtube.com/generate_204");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("HEAD");
                conn.setConnectTimeout(2500);
                conn.setReadTimeout(2500);
                conn.setRequestProperty("User-Agent", ANDROID_VR_USER_AGENT);
                conn.setRequestProperty("Connection", "keep-alive");
                conn.getResponseCode();
            } catch (Throwable ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
            try {
                SpotyFlowNewPipeEngine.ensureInit();
            } catch (Throwable ignored) {
            }
        });
    }

    private static String postJsonFast(String urlStr, String jsonBody, String userAgent, int connectMs, int readMs) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(connectMs);
            conn.setReadTimeout(readMs);
            conn.setDoOutput(true);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("User-Agent", userAgent);
            conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9,id;q=0.8");
            conn.setRequestProperty("Connection", "keep-alive");

            byte[] payload = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
                os.flush();
            }

            int code = conn.getResponseCode();
            InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (is == null) return "";
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }
            return (code >= 200 && code < 300) ? sb.toString() : "";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String findFirstVideoIdRecursive(Object node, int depth) {
        if (node == null || depth > 22) return null;
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            if (obj.has("musicResponsiveListItemRenderer")) {
                String inItem = findFirstVideoIdRecursive(obj.opt("musicResponsiveListItemRenderer"), depth + 1);
                if (isValidVideoId(inItem)) return inItem;
            }
            if (obj.has("videoId")) {
                String vid = obj.optString("videoId", "");
                if (isValidVideoId(vid)) return vid;
            }
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if ("trackingParams".equals(k) || "thumbnails".equals(k)) continue;
                String found = findFirstVideoIdRecursive(obj.opt(k), depth + 1);
                if (isValidVideoId(found)) return found;
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                String found = findFirstVideoIdRecursive(arr.opt(i), depth + 1);
                if (isValidVideoId(found)) return found;
            }
        }
        return null;
    }

    public static String searchVideoIdFast(String title, String artist) {
        String key = normalizeLookupKey(title, artist);
        if (key.equals("|")) return "";
        String cached = videoIdCache.get(key);
        if (isValidVideoId(cached)) return cached;

        String cleanTitle = title == null ? "" : title.trim();
        String cleanArtist = artist == null ? "" : artist.trim();
        String query = (cleanArtist.isEmpty() ? cleanTitle : (cleanArtist + " " + cleanTitle)).trim();
        if (query.isEmpty()) return "";

        try {
            // 1. YouTube Music WEB_REMIX search filtered to Songs
            JSONObject client = new JSONObject();
            client.put("clientName", "WEB_REMIX");
            client.put("clientVersion", "1.20250219.01.00");
            client.put("hl", "en");
            client.put("gl", "ID");
            JSONObject context = new JSONObject();
            context.put("client", client);
            JSONObject body = new JSONObject();
            body.put("context", context);
            body.put("query", query);
            body.put("params", "EgWKAQIIAWoMEAMQBBAJEAoQBRAV");

            String resp = postJsonFast("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", body.toString(), WEB_USER_AGENT, 3000, 4000);
            String found = resp.isEmpty() ? null : findFirstVideoIdRecursive(new JSONObject(resp), 0);

            // 2. Fallback 1x tanpa params filter Songs
            if (!isValidVideoId(found)) {
                body.remove("params");
                String resp2 = postJsonFast("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", body.toString(), WEB_USER_AGENT, 3000, 4000);
                found = resp2.isEmpty() ? null : findFirstVideoIdRecursive(new JSONObject(resp2), 0);
            }

            // 3. Fallback ke YouTube WEB search
            if (!isValidVideoId(found)) {
                JSONObject webClient = new JSONObject();
                webClient.put("clientName", "WEB");
                webClient.put("clientVersion", "2.20250219.01.00");
                webClient.put("hl", "en");
                webClient.put("gl", "ID");
                JSONObject webCtx = new JSONObject();
                webCtx.put("client", webClient);
                JSONObject webBody = new JSONObject();
                webBody.put("context", webCtx);
                webBody.put("query", query + " official audio");
                String resp3 = postJsonFast("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", webBody.toString(), WEB_USER_AGENT, 3000, 4000);
                found = resp3.isEmpty() ? null : findFirstVideoIdRecursive(new JSONObject(resp3), 0);
            }

            if (isValidVideoId(found)) {
                if (videoIdCache.size() >= MAX_VIDEO_ID_CACHE) {
                    videoIdCache.clear();
                }
                videoIdCache.put(key, found);
                return found;
            }
        } catch (Throwable ignored) {
        }
        return "";
    }

    private static FastStream resolveViaAndroidVrInnerTube(String videoId, boolean dataSaver) {
        try {
            JSONObject client = new JSONObject();
            client.put("clientName", "ANDROID_VR");
            client.put("clientVersion", "1.61.48");
            client.put("deviceMake", "Oculus");
            client.put("deviceModel", "Quest 3");
            client.put("osName", "Android");
            client.put("osVersion", "12");
            client.put("androidSdkVersion", 32);
            client.put("hl", "en");
            client.put("gl", "ID");

            JSONObject context = new JSONObject();
            context.put("client", client);

            JSONObject body = new JSONObject();
            body.put("videoId", videoId);
            body.put("contentCheckOk", true);
            body.put("racyCheckOk", true);
            body.put("context", context);

            String respStr = postJsonFast(
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
                    body.toString(),
                    ANDROID_VR_USER_AGENT,
                    3000,
                    4000
            );
            if (respStr == null || respStr.isEmpty()) return null;

            JSONObject root = new JSONObject(respStr);
            JSONObject streamingData = root.optJSONObject("streamingData");
            if (streamingData == null) return null;
            JSONArray formats = streamingData.optJSONArray("adaptiveFormats");
            if (formats == null || formats.length() == 0) return null;

            long durationSec = 0L;
            JSONObject details = root.optJSONObject("videoDetails");
            if (details != null) {
                try {
                    durationSec = Long.parseLong(details.optString("lengthSeconds", "0"));
                } catch (Throwable ignored) {
                }
            }

            String bestUrl = "";
            String bestMime = "audio/webm";
            int bestScore = Integer.MIN_VALUE;

            for (int i = 0; i < formats.length(); i++) {
                JSONObject fmt = formats.optJSONObject(i);
                if (fmt == null) continue;
                String mime = fmt.optString("mimeType", "");
                if (!mime.startsWith("audio/")) continue;
                String streamUrl = fmt.optString("url", "");
                if (streamUrl.isEmpty() || !streamUrl.startsWith("http")) continue;

                int itag = fmt.optInt("itag", 0);
                int bitrate = fmt.optInt("bitrate", 0);
                int kbps = bitrate / 1000;
                int score = 0;

                if (dataSaver) {
                    if (itag == 249 || itag == 250) score += 400;
                    else if (itag == 139) score += 350;
                    else if (itag == 140) score += 200;
                    else score += Math.max(0, 220 - Math.abs(kbps - 64));
                } else {
                    if (itag == 251) score += 500;
                    else if (itag == 140) score += 450;
                    else if (itag == 250) score += 320;
                    else score += Math.min(kbps, 300);
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = streamUrl;
                    bestMime = mime;
                }
            }

            if (bestUrl.isEmpty()) return null;
            long exp = System.currentTimeMillis() + STREAM_CACHE_TTL_MS;
            return new FastStream(true, bestUrl, ANDROID_VR_USER_AGENT, bestMime, durationSec, "EXO-FAST", false, exp, "");
        } catch (Throwable ignored) {
            return null;
        }
    }

    public static FastStream resolveFast(Context ctx, String trackId, String videoId, boolean dataSaver, boolean forceNewPipe) {
        // Cek 0: File Offline Lokal (0ms)
        if (ctx != null && trackId != null && !trackId.isEmpty()) {
            File offlineFile = SpotyFlowNewPipeEngine.getOfflineAudioFile(ctx, trackId);
            if (offlineFile.exists() && offlineFile.length() > 32768L) {
                return new FastStream(true, Uri.fromFile(offlineFile).toString(), ANDROID_VR_USER_AGENT, "audio/mp4", 0L,
                        "OFFLINE", true, Long.MAX_VALUE, "");
            }
        }
        if (!isValidVideoId(videoId)) {
            return new FastStream(false, "", ANDROID_VR_USER_AGENT, "", 0L, "NONE", false, 0L, "Invalid videoId");
        }

        final String cacheKey = videoId + (dataSaver ? "_low" : "_hi");
        final long now = System.currentTimeMillis();

        // Cek 1: RAM Cache (0ms)
        if (!forceNewPipe) {
            FastStream cached = streamCache.get(cacheKey);
            if (cached != null && cached.ok && cached.expiresAtMs > now && cached.url != null && !cached.url.isEmpty()) {
                return new FastStream(true, cached.url, cached.userAgent, cached.mimeType, cached.durationSec,
                        "EXO-CACHE", false, cached.expiresAtMs, "");
            }
        }

        // Lapis #1: Direct InnerTube ANDROID_VR JSON (~300-500ms)
        if (!forceNewPipe) {
            FastStream vrStream = resolveViaAndroidVrInnerTube(videoId, dataSaver);
            if (vrStream != null && vrStream.ok && vrStream.url != null && !vrStream.url.isEmpty()) {
                if (streamCache.size() >= MAX_STREAM_CACHE) streamCache.clear();
                streamCache.put(cacheKey, vrStream);
                return vrStream;
            }
        }

        // Lapis #2: Cadangan Otomatis NewPipeExtractor v0.27.1
        SpotyFlowNewPipeEngine.StreamResult np = SpotyFlowNewPipeEngine.resolveAudioStream(ctx, trackId, videoId, dataSaver);
        if (np != null && np.ok && np.streamUrl != null && !np.streamUrl.isEmpty()) {
            long exp = now + STREAM_CACHE_TTL_MS;
            FastStream npFast = new FastStream(true, np.streamUrl, ANDROID_VR_USER_AGENT, np.mimeType, np.durationSec,
                    np.isOffline ? "OFFLINE" : "EXO-NEWPIPE", np.isOffline, exp, "");
            if (!np.isOffline) {
                if (streamCache.size() >= MAX_STREAM_CACHE) streamCache.clear();
                streamCache.put(cacheKey, npFast);
            }
            return npFast;
        }

        return new FastStream(false, "", ANDROID_VR_USER_AGENT, "", 0L, "FAIL", false, 0L,
                np != null ? np.error : "All native resolvers failed");
    }

    public static void prefetchQueueItemAsync(final Context ctx, final String trackId, final String videoId,
                                              final String title, final String artist, final boolean dataSaver) {
        fastExecutor.execute(() -> {
            try {
                if (ctx != null && trackId != null && SpotyFlowNewPipeEngine.hasOfflineTrack(ctx, trackId)) {
                    return;
                }
                String resolvedVid = isValidVideoId(videoId) ? videoId : searchVideoIdFast(title, artist);
                if (!isValidVideoId(resolvedVid)) return;
                String cacheKey = resolvedVid + (dataSaver ? "_low" : "_hi");
                FastStream existing = streamCache.get(cacheKey);
                if (existing != null && existing.expiresAtMs > System.currentTimeMillis()) return;
                resolveFast(ctx, trackId, resolvedVid, dataSaver, false);
            } catch (Throwable ignored) {
            }
        });
    }
}
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
import android.graphics.Color;
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
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

@UnstableApi
public class SpotyFlowPlaybackService extends MediaSessionService {
    public static final String CHANNEL_GENERAL = "spotyflow_general";
    public static final String CHANNEL_PLAYBACK = "spotyflow_playback";
    public static final String CHANNEL_MUSIC = "spotyflow_music";
    public static final String CHANNEL_DOWNLOADS = "spotyflow_downloads";

    public static volatile SpotyFlowPlaybackService instance = null;
    public static volatile boolean isPlaying = false;
    public static volatile String lastWidgetTitle = "SpotyFlow";
    public static volatile String lastWidgetArtist = "Ketuk untuk memutar musik";
    public static volatile Bitmap lastWidgetBitmap = null;

    // Live Dynamic Island Lyrics & Adaptive Dominant Color (v2.0.0)
    public static volatile boolean islandLyricsEnabled = true;
    public static volatile String currentLyricLine = "";
    public static volatile String origTitle = "SpotyFlow";
    public static volatile String origArtist = "SpotyFlow";
    public static volatile int dominantColorInt = 0xFF1A1D24;

    private static volatile String pendingJsonPayload = null;
    private static volatile String pendingNativePlayPayload = null;
    private static volatile SimpleCache sharedExoCache = null;
    private static volatile boolean nativeExoActive = false;

    private volatile boolean serviceStarted = false;
    private final AtomicLong activePlayRequestSeq = new AtomicLong(0L);

    private Handler mainHandler;
    private ExecutorService artworkExecutor;
    private SpotyFlowRemotePlayer remotePlayer;
    private ExoPlayer exoPlayer;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean noisyReceiverRegistered = false;
    private String currentNativeTrackId = "";
    private String currentNativeVideoId = "";
    private long currentNativeStartMs = 0L;
    private boolean currentDataSaver = false;
    private boolean hasRetriedWithNewPipe = false;
    private long playStartRealtimeMs = 0L;
    private String currentEngineTag = "EXO-FAST";

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

    private final Runnable exoProgressTicker = new Runnable() {
        @Override
        public void run() {
            if (mainHandler == null) return;
            if (nativeExoActive && exoPlayer != null && exoPlayer.isPlaying()) {
                if (!MainActivity.isAppBackgrounded) {
                    try {
                        long pos = Math.max(0L, exoPlayer.getCurrentPosition());
                        long dur = exoPlayer.getDuration();
                        if (dur == C.TIME_UNSET || dur < 0L) dur = lastDurationMs;
                        JSONObject ev = new JSONObject();
                        ev.put("trackId", currentNativeTrackId);
                        ev.put("positionMs", pos);
                        ev.put("durationMs", dur);
                        ev.put("playbackRate", lastPlaybackRate);
                        ev.put("playing", true);
                        ev.put("isPlaying", true);
                        MainActivity.dispatchNativeAudioEvent("time", ev.toString());
                    } catch (Throwable ignored) {
                    }
                }
                mainHandler.postDelayed(this, 2000L);
            }
        }
    };

    private final BroadcastReceiver becomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                if (isPlaying) {
                    isPlaying = false;
                    updateWakeAndWifiLocks(false);
                    if (nativeExoActive && exoPlayer != null) {
                        try { exoPlayer.pause(); } catch (Throwable ignored) {}
                    }
                    if (remotePlayer != null) {
                        remotePlayer.setLocalPlayingState(false);
                    }
                    MainActivity.sendMediaActionToJs("noisy", 0L);
                    SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
                }
            }
        }
    };

    public static boolean isNativeExoActive() {
        return nativeExoActive;
    }

    private static synchronized SimpleCache getOrCreateSimpleCache(Context ctx) {
        if (sharedExoCache != null) return sharedExoCache;
        File cacheDir = new File(ctx.getCacheDir(), "sf_exo_cache");
        if (!cacheDir.exists()) cacheDir.mkdirs();
        LeastRecentlyUsedCacheEvictor evictor = new LeastRecentlyUsedCacheEvictor(180L * 1024L * 1024L);
        sharedExoCache = new SimpleCache(cacheDir, evictor, new StandaloneDatabaseProvider(ctx.getApplicationContext()));
        return sharedExoCache;
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

    private static void ensureServiceStartedSafe(Context ctx) {
        if (ctx == null) return;
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

    public static void dispatchPlayNativeTrack(Context ctx, String jsonPayload) {
        if (jsonPayload == null || jsonPayload.isEmpty()) return;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            if (!svc.serviceStarted && ctx != null && MainActivity.isActivityInForeground) {
                ensureServiceStartedSafe(ctx);
            }
            svc.mainHandler.post(() -> svc.playNativeTrackInternal(jsonPayload));
            return;
        }
        pendingNativePlayPayload = jsonPayload;
        ensureServiceStartedSafe(ctx);
    }

    public static void dispatchNativeControl(Context ctx, String cmd, long valueMs) {
        if (cmd == null || cmd.isEmpty()) return;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> svc.handleNativeControlInternal(cmd, valueMs));
        }
    }

    public static void dispatchLyricUpdate(Context ctx, String lyricText, boolean enabled) {
        String rawClean = lyricText == null ? "" : lyricText.trim();
        final String clean = rawClean.length() > 140 ? rawClean.substring(0, 140) : rawClean;
        if (clean.equals(currentLyricLine) && enabled == islandLyricsEnabled) {
            return;
        }
        currentLyricLine = clean;
        islandLyricsEnabled = enabled;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> {
                if (svc.remotePlayer != null) {
                    svc.remotePlayer.updateLiveLyric(clean, enabled);
                }
                if (svc.mediaSession != null && isPlaying) {
                    try {
                        svc.onUpdateNotification(svc.mediaSession, false);
                    } catch (Throwable ignored) {
                    }
                }
                SpotyFlowWidgetProvider.updateLyricsWidgetsOnly(svc.getApplicationContext());
            });
        } else if (ctx != null) {
            SpotyFlowWidgetProvider.updateLyricsWidgetsOnly(ctx);
        }
    }

    public static void dispatchStateUpdate(Context ctx, String jsonPayload) {
        if (jsonPayload == null || jsonPayload.isEmpty()) return;
        boolean playingQuick = false;
        boolean hasPlayingField = false;
        try {
            JSONObject quickObj = new JSONObject(jsonPayload);
            if (quickObj.has("isPlaying")) {
                hasPlayingField = true;
                playingQuick = quickObj.optBoolean("isPlaying", SpotyFlowPlaybackService.isPlaying);
                if (!nativeExoActive) {
                    SpotyFlowPlaybackService.isPlaying = playingQuick;
                }
            }
        } catch (Throwable ignored) {
        }
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            if (hasPlayingField && playingQuick && !svc.serviceStarted && ctx != null && MainActivity.isActivityInForeground) {
                ensureServiceStartedSafe(ctx);
            }
            svc.mainHandler.post(() -> svc.applyJsonState(jsonPayload));
            return;
        }
        pendingJsonPayload = jsonPayload;
        ensureServiceStartedSafe(ctx);
    }

    public static void requestStopService(Context ctx) {
        isPlaying = false;
        nativeExoActive = false;
        pendingJsonPayload = null;
        pendingNativePlayPayload = null;
        SpotyFlowPlaybackService svc = instance;
        if (svc != null && svc.mainHandler != null) {
            svc.mainHandler.post(() -> {
                svc.serviceStarted = false;
                svc.mainHandler.removeCallbacks(svc.exoProgressTicker);
                svc.updateWakeAndWifiLocks(false);
                if (svc.exoPlayer != null) {
                    try {
                        svc.exoPlayer.stop();
                        svc.exoPlayer.clearMediaItems();
                    } catch (Throwable ignored) {
                    }
                }
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
        initNativeExoPlayer();

        DefaultMediaNotificationProvider notificationProvider =
                new DefaultMediaNotificationProvider.Builder(this)
                        .setChannelId(CHANNEL_PLAYBACK)
                        .build();
        notificationProvider.setSmallIcon(R.drawable.ic_stat_music);
        setMediaNotificationProvider(notificationProvider);

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

        String queuedNative = pendingNativePlayPayload;
        pendingNativePlayPayload = null;
        if (queuedNative != null && !queuedNative.isEmpty()) {
            mainHandler.post(() -> playNativeTrackInternal(queuedNative));
        }

        String queued = pendingJsonPayload;
        pendingJsonPayload = null;
        if (queued != null && !queued.isEmpty()) {
            mainHandler.post(() -> applyJsonState(queued));
        }
    }

    private void initNativeExoPlayer() {
        try {
            SimpleCache cache = getOrCreateSimpleCache(this);
            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(5000)
                    .setReadTimeoutMs(7000)
                    .setUserAgent(SpotyFlowFastResolver.ANDROID_VR_USER_AGENT);

            DefaultDataSource.Factory upstreamFactory = new DefaultDataSource.Factory(this, httpFactory);

            CacheDataSource.Factory cacheDataSourceFactory = new CacheDataSource.Factory()
                    .setCache(cache)
                    .setUpstreamDataSourceFactory(upstreamFactory)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);

            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(25000, 60000, 900, 1800)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build();

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build();

            exoPlayer = new ExoPlayer.Builder(this)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(cacheDataSourceFactory))
                    .setLoadControl(loadControl)
                    .setAudioAttributes(audioAttributes, true)
                    .setHandleAudioBecomingNoisy(true)
                    .setWakeMode(C.WAKE_MODE_NETWORK)
                    .build();

            exoPlayer.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (!nativeExoActive || exoPlayer == null) return;
                    try {
                        if (playbackState == Player.STATE_BUFFERING) {
                            JSONObject ev = new JSONObject();
                            ev.put("trackId", currentNativeTrackId);
                            MainActivity.dispatchNativeAudioEvent("buffering", ev.toString());
                        } else if (playbackState == Player.STATE_READY) {
                            long dur = exoPlayer.getDuration();
                            if (dur == C.TIME_UNSET || dur < 1000L) dur = lastDurationMs;
                            if (dur >= 1000L) lastDurationMs = dur;
                            long pos = Math.max(0L, exoPlayer.getCurrentPosition());
                            long elapsedMs = playStartRealtimeMs > 0L
                                    ? Math.max(1L, SystemClock.elapsedRealtime() - playStartRealtimeMs)
                                    : 0L;
                            if (remotePlayer != null) {
                                remotePlayer.syncTimingFromExo(exoPlayer.isPlaying(), dur, pos);
                            }
                            JSONObject ev = new JSONObject();
                            ev.put("trackId", currentNativeTrackId);
                            ev.put("durationMs", dur);
                            ev.put("positionMs", pos);
                            ev.put("playbackRate", lastPlaybackRate);
                            ev.put("playing", exoPlayer.isPlaying());
                            ev.put("isPlaying", exoPlayer.isPlaying());
                            ev.put("engine", currentEngineTag);
                            ev.put("elapsedMs", elapsedMs);
                            ev.put("resolvedVideoId", currentNativeVideoId);
                            MainActivity.dispatchNativeAudioEvent("ready", ev.toString());
                        } else if (playbackState == Player.STATE_ENDED) {
                            isPlaying = false;
                            mainHandler.removeCallbacks(exoProgressTicker);
                            if (remotePlayer != null) {
                                remotePlayer.setLocalPlayingState(false);
                            }
                            JSONObject ev = new JSONObject();
                            ev.put("trackId", currentNativeTrackId);
                            ev.put("videoId", currentNativeVideoId);
                            MainActivity.dispatchNativeAudioEvent("ended", ev.toString());
                            SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
                        }
                    } catch (Throwable ignored) {
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean playingNow) {
                    if (!nativeExoActive || exoPlayer == null) return;
                    isPlaying = playingNow;
                    updateWakeAndWifiLocks(playingNow);
                    long dur = exoPlayer.getDuration();
                    if (dur == C.TIME_UNSET || dur < 1000L) dur = lastDurationMs;
                    long pos = Math.max(0L, exoPlayer.getCurrentPosition());
                    if (remotePlayer != null) {
                        remotePlayer.syncTimingFromExo(playingNow, dur, pos);
                    }
                    mainHandler.removeCallbacks(exoProgressTicker);
                    if (playingNow) {
                        mainHandler.postDelayed(exoProgressTicker, 2000L);
                    }
                    try {
                        JSONObject ev = new JSONObject();
                        ev.put("trackId", currentNativeTrackId);
                        ev.put("positionMs", pos);
                        ev.put("durationMs", dur);
                        ev.put("playbackRate", lastPlaybackRate);
                        ev.put("playing", playingNow);
                        ev.put("isPlaying", playingNow);
                        ev.put("engine", currentEngineTag);
                        ev.put("resolvedVideoId", currentNativeVideoId);
                        MainActivity.dispatchNativeAudioEvent(playingNow ? "playing" : "paused", ev.toString());
                    } catch (Throwable ignored) {
                    }
                    SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
                    if (mediaSession != null) {
                        try {
                            onUpdateNotification(mediaSession, playingNow);
                        } catch (Throwable ignored) {
                        }
                    }
                }

                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    if (!nativeExoActive) return;
                    // Auto-Retry 1x ke Lapis #2 (NewPipeExtractor) sebelum menyerah ke SFYtFull!
                    if (!hasRetriedWithNewPipe && SpotyFlowFastResolver.isValidVideoId(currentNativeVideoId)) {
                        hasRetriedWithNewPipe = true;
                        final String retryTrackId = currentNativeTrackId;
                        final String retryVideoId = currentNativeVideoId;
                        final boolean retryDataSaver = currentDataSaver;
                        final long retryStartMs = Math.max(currentNativeStartMs, exoPlayer != null ? Math.max(0L, exoPlayer.getCurrentPosition()) : 0L);
                        final long retrySeq = activePlayRequestSeq.get();
                        SpotyFlowFastResolver.invalidateStream(retryVideoId);
                        SpotyFlowFastResolver.getExecutor().execute(() -> {
                            final SpotyFlowFastResolver.FastStream fallbackRes = SpotyFlowFastResolver.resolveFast(
                                    getApplicationContext(), retryTrackId, retryVideoId, retryDataSaver, true
                            );
                            if (mainHandler == null) return;
                            mainHandler.post(() -> {
                                if (retrySeq != activePlayRequestSeq.get() || !nativeExoActive || exoPlayer == null) return;
                                if (fallbackRes != null && fallbackRes.ok && fallbackRes.url != null && !fallbackRes.url.isEmpty()) {
                                    try {
                                        currentEngineTag = fallbackRes.engineTag;
                                        if (fallbackRes.durationSec > 0L) lastDurationMs = fallbackRes.durationSec * 1000L;
                                        MediaItem.Builder retryBuilder = new MediaItem.Builder()
                                                .setMediaId(retryTrackId)
                                                .setUri(Uri.parse(fallbackRes.url));
                                        exoPlayer.setMediaItem(retryBuilder.build());
                                        exoPlayer.prepare();
                                        if (retryStartMs > 500L) exoPlayer.seekTo(retryStartMs);
                                        exoPlayer.play();
                                        return;
                                    } catch (Throwable ignored) {
                                    }
                                }
                                emitNativeErrorAndStop(retryTrackId, retryVideoId, error.getMessage());
                            });
                        });
                        return;
                    }
                    emitNativeErrorAndStop(currentNativeTrackId, currentNativeVideoId, error.getMessage());
                }
            });
        } catch (Throwable ignored) {
        }
    }

    private void emitNativeErrorAndStop(String trackId, String videoId, String message) {
        nativeExoActive = false;
        isPlaying = false;
        if (mainHandler != null) mainHandler.removeCallbacks(exoProgressTicker);
        try {
            JSONObject ev = new JSONObject();
            ev.put("trackId", trackId != null ? trackId : "");
            ev.put("videoId", videoId != null ? videoId : "");
            ev.put("message", message != null ? message : "ExoPlayer error");
            MainActivity.dispatchNativeAudioEvent("error", ev.toString());
        } catch (Throwable ignored) {
        }
    }

    private void playNativeTrackInternal(String jsonPayload) {
        if (exoPlayer == null) {
            initNativeExoPlayer();
        }
        if (exoPlayer == null) {
            emitNativeErrorAndStop("", "", "ExoPlayer unavailable");
            return;
        }
        try {
            JSONObject obj = new JSONObject(jsonPayload);
            final String trackId = obj.optString("trackId", "track");
            final String initialVideoId = obj.optString("videoId", "").trim();
            final String title = obj.optString("title", "SpotyFlow");
            final String artist = obj.optString("artist", "SpotyFlow");
            final String album = obj.optString("album", "SpotyFlow");
            String rawCoverUrl = obj.optString("coverUrl", "https://spotyflow.vercel.app/icon-512.png");
            final String safeCoverUrl = (rawCoverUrl.startsWith("https://") || rawCoverUrl.startsWith("http://"))
                    ? rawCoverUrl
                    : "https://spotyflow.vercel.app/icon-512.png";
            final long startMs = Math.max(0L, (long) (obj.optDouble("startSec", 0.0) * 1000.0));
            final boolean dataSaver = obj.optBoolean("dataSaver", false);
            final long reqSeq = activePlayRequestSeq.incrementAndGet();

            playStartRealtimeMs = SystemClock.elapsedRealtime();
            hasRetriedWithNewPipe = false;
            currentDataSaver = dataSaver;
            currentEngineTag = "EXO-FAST";
            currentNativeTrackId = trackId;
            currentNativeVideoId = initialVideoId;
            currentNativeStartMs = startMs;
            nativeExoActive = true;
            currentLyricLine = "";
            origTitle = title;
            origArtist = artist;
            lastTrackId = trackId;
            lastTitle = title;
            lastArtist = artist;
            lastAlbum = album;
            lastCoverUrl = safeCoverUrl;
            lastWidgetTitle = title;
            lastWidgetArtist = artist;

            // Update metadata instan (0ms!) ke Dynamic Island & 3 Widget sebelum stream selesai resolve
            byte[] artForCover = safeCoverUrl.equals(cachedCoverUrl) ? cachedArtworkBytes : null;
            if (artForCover != null) {
                updateWidgetBitmapFromBytes(artForCover);
            }
            if (remotePlayer != null) {
                remotePlayer.updateFromJs(trackId, title, artist, album, safeCoverUrl, artForCover, true, Math.max(1000L, lastDurationMs), startMs, lastPlaybackRate);
            }
            SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
            if (!safeCoverUrl.equals(cachedCoverUrl) && !safeCoverUrl.equals(fetchingCoverUrl)) {
                fetchAndCacheCoverAsync(safeCoverUrl);
            }

            try {
                JSONObject bev = new JSONObject();
                bev.put("trackId", trackId);
                MainActivity.dispatchNativeAudioEvent("buffering", bev.toString());
            } catch (Throwable ignored) {
            }

            SpotyFlowFastResolver.getExecutor().execute(() -> {
                String vid = initialVideoId;
                boolean hasLocalOffline = SpotyFlowNewPipeEngine.hasOfflineTrack(getApplicationContext(), trackId);
                if (!hasLocalOffline && !SpotyFlowFastResolver.isValidVideoId(vid)) {
                    vid = SpotyFlowFastResolver.searchVideoIdFast(title, artist);
                }
                if (reqSeq != activePlayRequestSeq.get()) return;
                final String finalVid = vid != null ? vid : "";
                final SpotyFlowFastResolver.FastStream res = SpotyFlowFastResolver.resolveFast(
                        getApplicationContext(), trackId, finalVid, dataSaver, false
                );
                if (mainHandler == null) return;
                mainHandler.post(() -> {
                    if (reqSeq != activePlayRequestSeq.get() || !nativeExoActive || exoPlayer == null) return;
                    if (res == null || !res.ok || res.url == null || res.url.isEmpty()) {
                        emitNativeErrorAndStop(trackId, finalVid, res != null ? res.error : "Resolve failed");
                        return;
                    }
                    try {
                        currentNativeVideoId = finalVid;
                        currentEngineTag = res.engineTag;
                        if (res.durationSec > 0L) {
                            lastDurationMs = res.durationSec * 1000L;
                        }
                        MediaItem.Builder itemBuilder = new MediaItem.Builder()
                                .setMediaId(trackId)
                                .setUri(Uri.parse(res.url));
                        if (!res.isOffline && SpotyFlowFastResolver.isValidVideoId(finalVid)) {
                            itemBuilder.setCustomCacheKey("yt_" + finalVid + "_" + (dataSaver ? "ds" : "hq"));
                        }
                        exoPlayer.setMediaItem(itemBuilder.build());
                        if (startMs > 500L) {
                            exoPlayer.seekTo(startMs);
                        }
                        exoPlayer.setPlayWhenReady(true);
                        exoPlayer.prepare();
                    } catch (Throwable t) {
                        emitNativeErrorAndStop(trackId, finalVid, t.getMessage());
                    }
                });
            });
        } catch (Throwable ignored) {
        }
    }

    private void handleNativeControlInternal(String cmd, long valueMs) {
        if (exoPlayer == null) return;
        try {
            if ("play".equals(cmd)) {
                if (nativeExoActive) {
                    exoPlayer.setPlayWhenReady(true);
                    exoPlayer.play();
                }
            } else if ("pause".equals(cmd)) {
                exoPlayer.pause();
            } else if ("stop".equals(cmd)) {
                activePlayRequestSeq.incrementAndGet();
                nativeExoActive = false;
                mainHandler.removeCallbacks(exoProgressTicker);
                exoPlayer.pause();
                exoPlayer.stop();
                exoPlayer.clearMediaItems();
            } else if ("seek".equals(cmd)) {
                if (nativeExoActive) {
                    long target = Math.max(0L, valueMs);
                    exoPlayer.seekTo(target);
                    long dur = exoPlayer.getDuration();
                    if (dur == C.TIME_UNSET || dur < 1000L) dur = lastDurationMs;
                    if (remotePlayer != null) {
                        remotePlayer.syncTimingFromExo(exoPlayer.isPlaying(), dur, target);
                    }
                    try {
                        JSONObject ev = new JSONObject();
                        ev.put("trackId", currentNativeTrackId);
                        ev.put("positionMs", target);
                        ev.put("durationMs", dur);
                        ev.put("playbackRate", lastPlaybackRate);
                        ev.put("playing", exoPlayer.isPlaying());
                        ev.put("isPlaying", exoPlayer.isPlaying());
                        MainActivity.dispatchNativeAudioEvent("seeked", ev.toString());
                    } catch (Throwable ignored) {
                    }
                }
            } else if ("volume".equals(cmd)) {
                float vol = Math.max(0f, Math.min(1f, valueMs / 100f));
                exoPlayer.setVolume(vol);
            } else if ("speed".equals(cmd)) {
                float spd = Math.max(0.25f, Math.min(2.5f, valueMs / 100f));
                lastPlaybackRate = spd;
                exoPlayer.setPlaybackParameters(new PlaybackParameters(spd));
                if (remotePlayer != null) {
                    remotePlayer.setLocalPlaybackRate(spd);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        serviceStarted = true;
        super.onStartCommand(intent, flags, startId);
        String queuedNative = pendingNativePlayPayload;
        pendingNativePlayPayload = null;
        if (queuedNative != null && !queuedNative.isEmpty()) {
            playNativeTrackInternal(queuedNative);
        }
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
        nativeExoActive = false;
        isPlaying = false;
        if (mainHandler != null) {
            mainHandler.removeCallbacks(exoProgressTicker);
        }
        updateWakeAndWifiLocks(false);
        unregisterBecomingNoisyReceiver();
        if (artworkExecutor != null) {
            artworkExecutor.shutdownNow();
            artworkExecutor = null;
        }
        if (exoPlayer != null) {
            try {
                exoPlayer.release();
            } catch (Exception ignored) {
            }
            exoPlayer = null;
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
            boolean playingNow = nativeExoActive && exoPlayer != null ? exoPlayer.isPlaying() : obj.optBoolean("isPlaying", false);
            long durationMs = Math.max(1000L, obj.optLong("durationMs", 210000L));
            long positionMs = Math.max(0L, obj.optLong("positionMs", 0L));
            float playbackRate = (float) obj.optDouble("playbackRate", 1.0);
            if (playbackRate <= 0.1f || playbackRate > 4.0f) playbackRate = 1.0f;

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

            if (!trackId.equals(lastTrackId)) {
                currentLyricLine = "";
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

            origTitle = title;
            origArtist = artist;
            isPlaying = playingNow;
            lastWidgetTitle = title;
            lastWidgetArtist = artist;
            updateWakeAndWifiLocks(playingNow);

            byte[] artForCover = coverUrl.equals(cachedCoverUrl) ? cachedArtworkBytes : null;
            if (artForCover != null) {
                updateWidgetBitmapFromBytes(artForCover);
            }
            remotePlayer.updateFromJs(
                    trackId, title, artist, album, coverUrl, artForCover,
                    playingNow, durationMs, positionMs, playbackRate
            );

            try {
                SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
            } catch (Throwable ignored) {
            }

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
                conn.setRequestProperty("User-Agent", "SpotyFlow-Android/2.0");
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
                            updateWidgetBitmapFromBytes(finalBytes);
                            remotePlayer.updateArtworkBytes(finalBytes);
                            try {
                                SpotyFlowWidgetProvider.updateAllWidgets(getApplicationContext());
                            } catch (Throwable ignored) {
                            }
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

    private void extractDominantColorFromBitmap(Bitmap bmp) {
        if (bmp == null || bmp.isRecycled()) return;
        try {
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            if (w < 4 || h < 4) return;
            long sumR = 0L, sumG = 0L, sumB = 0L;
            int count = 0;
            for (int row = 1; row <= 4; row++) {
                int py = Math.min(h - 1, (h * row) / 5);
                for (int col = 1; col <= 4; col++) {
                    int px = Math.min(w - 1, (w * col) / 5);
                    int pxColor = bmp.getPixel(px, py);
                    sumR += Color.red(pxColor);
                    sumG += Color.green(pxColor);
                    sumB += Color.blue(pxColor);
                    count++;
                }
            }
            if (count > 0) {
                int avgR = (int) (sumR / count);
                int avgG = (int) (sumG / count);
                int avgB = (int) (sumB / count);
                // Gelapkan 45% agar teks putih & lirik di Widget 4x2 selalu terbaca tajam
                int darkR = Math.max(18, Math.min(92, (int) (avgR * 0.45f)));
                int darkG = Math.max(20, Math.min(92, (int) (avgG * 0.45f)));
                int darkB = Math.max(26, Math.min(104, (int) (avgB * 0.45f)));
                dominantColorInt = Color.argb(236, darkR, darkG, darkB);
            }
        } catch (Throwable ignored) {
        }
    }

    private void updateWidgetBitmapFromBytes(byte[] jpegBytes) {
        if (jpegBytes == null || jpegBytes.length < 64) return;
        try {
            Bitmap decoded = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.length);
            if (decoded == null) return;
            extractDominantColorFromBitmap(decoded);
            int w = decoded.getWidth();
            int h = decoded.getHeight();
            if (w > 160 || h > 160) {
                float scale = Math.min(160f / Math.max(1, w), 160f / Math.max(1, h));
                int nw = Math.max(1, Math.round(w * scale));
                int nh = Math.max(1, Math.round(h * scale));
                Bitmap scaled = Bitmap.createScaledBitmap(decoded, nw, nh, true);
                if (scaled != decoded) {
                    decoded.recycle();
                }
                lastWidgetBitmap = scaled;
            } else {
                lastWidgetBitmap = decoded;
            }
        } catch (Throwable ignored) {
        }
    }

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
        private String liveLyric = "";
        private boolean lyricsInIsland = true;

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
            if (!trackId.equals(this.trackId)) {
                this.liveLyric = "";
            }
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

        void syncTimingFromExo(boolean playingNow, long durMs, long posMs) {
            this.playing = playingNow;
            if (durMs > 1000L) this.durationMs = durMs;
            this.anchorPosMs = Math.max(0L, posMs);
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            invalidateState();
        }

        void setLocalPlaybackRate(float rate) {
            this.anchorPosMs = livePositionSupplier.get();
            this.anchorRealtimeMs = SystemClock.elapsedRealtime();
            this.playbackRate = rate;
            invalidateState();
        }

        void updateLiveLyric(String lyric, boolean enabled) {
            this.liveLyric = lyric != null ? lyric : "";
            this.lyricsInIsland = enabled;
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
                boolean showLyric = lyricsInIsland && liveLyric != null && !liveLyric.isEmpty();
                String shownTitle = showLyric ? ("♪ " + liveLyric) : title;
                String shownArtist = showLyric ? (title + " • " + artist) : artist;

                MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                        .setTitle(shownTitle)
                        .setArtist(shownArtist)
                        .setAlbumTitle(album)
                        .setDisplayTitle(shownTitle)
                        .setSubtitle(shownArtist)
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
                if (nativeExoActive && svc.exoPlayer != null) {
                    if (playWhenReady) svc.exoPlayer.play();
                    else svc.exoPlayer.pause();
                }
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
                SpotyFlowPlaybackService svc = SpotyFlowPlaybackService.instance;
                if (svc != null && nativeExoActive && svc.exoPlayer != null) {
                    svc.exoPlayer.seekTo(this.anchorPosMs);
                }
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
                if (nativeExoActive && svc.exoPlayer != null) {
                    svc.exoPlayer.pause();
                }
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
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.BridgeActivity;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

@UnstableApi
public class MainActivity extends BridgeActivity {
    private static final int REQ_SPOTYFLOW_PERMISSIONS = 1001;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);
    public static volatile boolean isActivityInForeground = false;
    public static volatile boolean isAppBackgrounded = false;

    private Handler mainHandler;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean bridgeAttached = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        isActivityInForeground = true;
        mainHandler = new Handler(Looper.getMainLooper());

        // Buat 4 kategori notifikasi persis Spotify segera saat app dibuka & hangatkan koneksi YouTube
        SpotyFlowPlaybackService.ensureNotificationChannels(this);
        SpotyFlowFastResolver.warmUpAsync();

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

    public static boolean hasActiveWebView() {
        try {
            MainActivity act = activeInstance != null ? activeInstance.get() : null;
            return act != null
                    && !act.isFinishing()
                    && !act.isDestroyed()
                    && act.getBridge() != null
                    && act.getBridge().getWebView() != null;
        } catch (Throwable ignored) {
            return false;
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
        isAppBackgrounded = isBg;
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

    public static void dispatchNativeAudioEvent(final String type, final String payloadJson) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || type == null) return;
        final String qType = JSONObject.quote(type);
        final String safePayload = (payloadJson != null && !payloadJson.isEmpty()) ? payloadJson : "{}";
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfOnNativeAudioEvent){window.__sfOnNativeAudioEvent("
                            + qType + "," + safePayload + ");}}catch(e){}";
                    act.getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public static void dispatchOfflineProgress(final String trackId, final int percent, final String status) {
        MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || trackId == null) return;
        final String qId = JSONObject.quote(trackId);
        final String qStatus = JSONObject.quote(status != null ? status : "downloading");
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfOnOfflineDownloadProgress){window.__sfOnOfflineDownloadProgress("
                            + qId + "," + percent + "," + qStatus + ");}}catch(e){}";
                    act.getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public static void dispatchDepthMaskResult(final String reqId, final String resultJson) {
        final MainActivity act = activeInstance != null ? activeInstance.get() : null;
        if (act == null || reqId == null) return;
        final String qId = JSONObject.quote(reqId);
        final String safeJson = (resultJson != null && !resultJson.isEmpty()) ? resultJson : "{\\"ok\\":false}";
        act.runOnUiThread(() -> {
            try {
                if (act.getBridge() != null && act.getBridge().getWebView() != null) {
                    String js = "try{if(window.__sfOnDepthMaskReady){window.__sfOnDepthMaskReady("
                            + qId + "," + safeJson + ");}}catch(e){}";
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
        isAppBackgrounded = false;
        dispatchAppBackgroundedToWebView(false);
        dispatchAppVisibilityToWebView(true);
    }

    @Override
    public void onPause() {
        isActivityInForeground = false;
        isAppBackgrounded = true;
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
        public void playNativeTrack(final String jsonPayload) {
            SpotyFlowPlaybackService.dispatchPlayNativeTrack(getApplicationContext(), jsonPayload);
        }

        @JavascriptInterface
        public void prefetchTrack(final String videoId, final boolean dataSaver) {
            SpotyFlowFastResolver.prefetchQueueItemAsync(getApplicationContext(), "", videoId, "", "", dataSaver);
        }

        @JavascriptInterface
        public void prefetchTrackMeta(final String trackId, final String videoId, final String title, final String artist, final boolean dataSaver) {
            SpotyFlowFastResolver.prefetchQueueItemAsync(getApplicationContext(), trackId, videoId, title, artist, dataSaver);
        }

        @JavascriptInterface
        public String savePosterToGallery(final String base64Png, final String fileName) {
            try {
                final Uri savedUri = savePosterPngToMediaStore(base64Png, fileName);
                final String safeName = sanitizePosterFileName(fileName);
                JSONObject res = new JSONObject();
                res.put("ok", savedUri != null);
                res.put("fileName", safeName);
                if (savedUri == null) {
                    res.put("error", "Gagal menulis file gambar ke MediaStore");
                }
                return res.toString();
            } catch (Throwable t) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("ok", false);
                    err.put("error", t.getMessage() != null ? t.getMessage() : "Gagal menyimpan poster");
                    return err.toString();
                } catch (Throwable ignored) {
                    return "{\\"ok\\":false,\\"error\\":\\"Save failed\\"}";
                }
            }
        }

        @JavascriptInterface
        public boolean sharePosterImage(final String base64Png, final String fileName) {
            try {
                final Uri savedUri = savePosterPngToMediaStore(base64Png, fileName);
                if (savedUri == null) return false;
                runOnUiThread(() -> {
                    try {
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType("image/png");
                        shareIntent.putExtra(Intent.EXTRA_STREAM, savedUri);
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        Intent chooser = Intent.createChooser(shareIntent, "Bagikan Poster SpotyFlow");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                    } catch (Throwable ignored) {
                    }
                });
                return true;
            } catch (Throwable ignored) {
                return false;
            }
        }

        private String sanitizePosterFileName(String raw) {
            String base = (raw == null || raw.trim().isEmpty()) ? ("SpotyFlow-Poster-" + System.currentTimeMillis() + ".png") : raw.trim();
            base = base.replaceAll("[^a-zA-Z0-9._-]", "_");
            while (base.startsWith(".")) base = base.substring(1);
            if (base.isEmpty()) base = "SpotyFlow-Poster.png";
            if (!base.toLowerCase().endsWith(".png")) base = base + ".png";
            return base;
        }

        private Uri savePosterPngToMediaStore(String base64Png, String fileName) throws Exception {
            if (base64Png == null || base64Png.isEmpty()) return null;
            String pureB64 = base64Png;
            int commaIdx = pureB64.indexOf(',');
            if (commaIdx >= 0) {
                pureB64 = pureB64.substring(commaIdx + 1);
            }
            byte[] pngBytes = Base64.decode(pureB64, Base64.DEFAULT);
            if (pngBytes == null || pngBytes.length < 128) return null;

            String safeName = sanitizePosterFileName(fileName);
            ContentResolver resolver = getApplicationContext().getContentResolver();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SpotyFlow");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);

                Uri itemUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (itemUri == null) return null;
                try (OutputStream os = resolver.openOutputStream(itemUri)) {
                    if (os == null) return null;
                    os.write(pngBytes);
                    os.flush();
                }
                ContentValues doneVals = new ContentValues();
                doneVals.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(itemUri, doneVals, null, null);
                return itemUri;
            } else {
                File picDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "SpotyFlow");
                if (!picDir.exists()) picDir.mkdirs();
                File outFile = new File(picDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(pngBytes);
                    fos.flush();
                }
                MediaScannerConnection.scanFile(getApplicationContext(), new String[]{outFile.getAbsolutePath()}, new String[]{"image/png"}, null);
                ContentValues legacyVals = new ContentValues();
                legacyVals.put(MediaStore.Images.Media.DATA, outFile.getAbsolutePath());
                legacyVals.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                Uri inserted = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, legacyVals);
                return inserted != null ? inserted : Uri.fromFile(outFile);
            }
        }

        @JavascriptInterface
        public void nativeControl(final String cmd, final long valueMs) {
            SpotyFlowPlaybackService.dispatchNativeControl(getApplicationContext(), cmd, valueMs);
        }

        @JavascriptInterface
        public void updateLyricLine(final String lyricText, final boolean enabled) {
            SpotyFlowPlaybackService.dispatchLyricUpdate(getApplicationContext(), lyricText, enabled);
        }

        @JavascriptInterface
        public void downloadOfflineTrack(final String trackId, final String videoId) {
            SpotyFlowNewPipeEngine.downloadOfflineAsync(
                    getApplicationContext(),
                    trackId,
                    videoId,
                    (id, percent, status) -> MainActivity.dispatchOfflineProgress(id, percent, status)
            );
        }

        @JavascriptInterface
        public boolean hasOfflineTrack(final String trackId) {
            return SpotyFlowNewPipeEngine.hasOfflineTrack(getApplicationContext(), trackId);
        }

        @JavascriptInterface
        public boolean deleteOfflineTrack(final String trackId) {
            return SpotyFlowNewPipeEngine.deleteOfflineTrack(getApplicationContext(), trackId);
        }

        @JavascriptInterface
        public String getOfflineTracksJson() {
            return SpotyFlowNewPipeEngine.getOfflineTracksJson(getApplicationContext());
        }

        @JavascriptInterface
        public void stopService() {
            SpotyFlowPlaybackService.requestStopService(getApplicationContext());
        }

        @JavascriptInterface
        public String getSystemStatus() {
            try {
                boolean notifEnabled = NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
                boolean batteryIgnored = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    batteryIgnored = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                }
                JSONObject obj = new JSONObject();
                obj.put("notificationsEnabled", notifEnabled);
                obj.put("batteryOptimizedIgnored", batteryIgnored);
                obj.put("sdkInt", Build.VERSION.SDK_INT);
                return obj.toString();
            } catch (Throwable e) {
                return "{\\"notificationsEnabled\\":false,\\"batteryOptimizedIgnored\\":false,\\"sdkInt\\":" + Build.VERSION.SDK_INT + "}";
            }
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                    }
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    try {
                        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(fallback);
                    } catch (Exception ignored) {
                    }
                }
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

        @JavascriptInterface
        public boolean hasDepthEngine() {
            return true;
        }

        @JavascriptInterface
        public void segmentPhotoDepthAsync(final String reqId, final String base64Image) {
            final String safeReqId = reqId != null ? reqId : "";
            SpotyFlowDepthEngine.segmentSubjectAsync(base64Image, new SpotyFlowDepthEngine.DepthCallback() {
                @Override
                public void onResult(final String resultJson) {
                    MainActivity.dispatchDepthMaskResult(safeReqId, resultJson);
                }
            });
        }
    }
}
`;

// =========================================================================
// 9. SpotyFlowDepthEngine.java (v2.0.2 Offline Google ML Kit Selfie Cutout)
// =========================================================================
const SPOTYFLOW_DEPTH_ENGINE_JAVA = `package ${APP_ID};

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.Segmentation;
import com.google.mlkit.vision.segmentation.SegmentationMask;
import com.google.mlkit.vision.segmentation.Segmenter;
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SpotyFlowDepthEngine {
    public interface DepthCallback {
        void onResult(String resultJson);
    }

    private static final ExecutorService DEPTH_EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile Segmenter cachedSegmenter = null;

    private static synchronized Segmenter getSegmenter() {
        if (cachedSegmenter == null) {
            SelfieSegmenterOptions options = new SelfieSegmenterOptions.Builder()
                    .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
                    .build();
            cachedSegmenter = Segmentation.getClient(options);
        }
        return cachedSegmenter;
    }

    private static String buildErrorJson(String msg) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("ok", false);
            obj.put("hasSubject", false);
            obj.put("error", msg != null ? msg : "Depth segmentation failed");
            return obj.toString();
        } catch (Throwable ignored) {
            return "{\\"ok\\":false,\\"hasSubject\\":false}";
        }
    }

    private static Bitmap decodeDownscaledBitmap(byte[] bytes, int maxDim) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int rawW = bounds.outWidth;
        int rawH = bounds.outHeight;
        if (rawW <= 0 || rawH <= 0) return null;

        int sample = 1;
        while ((rawW / sample) > maxDim * 2 || (rawH / sample) > maxDim * 2) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        if (decoded == null) return null;

        int w = decoded.getWidth();
        int h = decoded.getHeight();
        int longest = Math.max(w, h);
        if (longest <= maxDim) return decoded;

        float ratio = (float) maxDim / (float) longest;
        int targetW = Math.max(1, Math.round(w * ratio));
        int targetH = Math.max(1, Math.round(h * ratio));
        Bitmap scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true);
        if (scaled != decoded) {
            decoded.recycle();
        }
        return scaled;
    }

    public static void segmentSubjectAsync(final String base64Image, final DepthCallback callback) {
        if (callback == null) return;
        DEPTH_EXECUTOR.execute(() -> {
            try {
                if (base64Image == null || base64Image.isEmpty()) {
                    callback.onResult(buildErrorJson("Empty image"));
                    return;
                }
                String pureB64 = base64Image;
                int commaIdx = pureB64.indexOf(',');
                if (commaIdx >= 0) {
                    pureB64 = pureB64.substring(commaIdx + 1);
                }
                byte[] imgBytes = Base64.decode(pureB64, Base64.DEFAULT);
                if (imgBytes == null || imgBytes.length < 64) {
                    callback.onResult(buildErrorJson("Invalid image bytes"));
                    return;
                }
                final Bitmap scaledBitmap = decodeDownscaledBitmap(imgBytes, 512);
                if (scaledBitmap == null) {
                    callback.onResult(buildErrorJson("Bitmap decode failed"));
                    return;
                }

                InputImage inputImage = InputImage.fromBitmap(scaledBitmap, 0);
                Segmenter segmenter = getSegmenter();
                segmenter.process(inputImage)
                        .addOnSuccessListener(DEPTH_EXECUTOR, (final SegmentationMask mask) -> {
                            Bitmap maskBmp = null;
                            try {
                                ByteBuffer buffer = mask.getBuffer();
                                int w = mask.getWidth();
                                int h = mask.getHeight();
                                buffer.rewind();

                                int total = w * h;
                                int[] pixels = new int[total];
                                int fgCount = 0;
                                final float low = 0.28f;
                                final float high = 0.78f;
                                final float span = high - low;

                                for (int i = 0; i < total; i++) {
                                    float conf = buffer.getFloat();
                                    if (conf > 0.55f) fgCount++;
                                    float t = Math.max(0f, Math.min(1f, (conf - low) / span));
                                    float smooth = t * t * (3f - 2f * t);
                                    int alpha = Math.round(smooth * 255f);
                                    pixels[i] = (alpha << 24) | 0x00FFFFFF;
                                }

                                maskBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                                maskBmp.setPixels(pixels, 0, w, 0, 0, w, h);

                                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                                maskBmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
                                String b64Mask = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

                                float coverage = (float) fgCount / (float) Math.max(1, total);
                                boolean hasSubject = (coverage >= 0.035f && coverage <= 0.96f);

                                JSONObject out = new JSONObject();
                                out.put("ok", true);
                                out.put("hasSubject", hasSubject);
                                out.put("coverage", coverage);
                                out.put("width", w);
                                out.put("height", h);
                                out.put("maskDataUrl", "data:image/png;base64," + b64Mask);
                                callback.onResult(out.toString());
                            } catch (Throwable t) {
                                callback.onResult(buildErrorJson(t.getMessage()));
                            } finally {
                                if (maskBmp != null && !maskBmp.isRecycled()) {
                                    maskBmp.recycle();
                                }
                                if (!scaledBitmap.isRecycled()) {
                                    scaledBitmap.recycle();
                                }
                            }
                        })
                        .addOnFailureListener(DEPTH_EXECUTOR, (final Exception e) -> {
                            if (!scaledBitmap.isRecycled()) {
                                scaledBitmap.recycle();
                            }
                            callback.onResult(buildErrorJson(e != null ? e.getMessage() : "ML Kit failed"));
                        });
            } catch (Throwable t) {
                callback.onResult(buildErrorJson(t.getMessage()));
            }
        });
    }
}
`;

function patchRootBuildGradle() {
  if (fs.existsSync(ROOT_BUILD_GRADLE)) {
    let content = fs.readFileSync(ROOT_BUILD_GRADLE, 'utf8');
    let changed = false;
    if (!content.includes('google()')) {
      content = content.replace(/(allprojects\s*\{\s*[\s\S]*?repositories\s*\{)/, `$1\n        google()`);
      changed = true;
    }
    if (!content.includes('mavenCentral()')) {
      content = content.replace(/(allprojects\s*\{\s*[\s\S]*?repositories\s*\{)/, `$1\n        mavenCentral()`);
      changed = true;
    }
    if (!content.includes('https://jitpack.io')) {
      content = content.replace(
        /(allprojects\s*\{\s*[\s\S]*?repositories\s*\{)/,
        `$1\n        maven { url 'https://jitpack.io' }`
      );
      changed = true;
    }
    if (changed) fs.writeFileSync(ROOT_BUILD_GRADLE, content, 'utf8');
    console.log('  + Patched android/build.gradle (ensured google(), mavenCentral(), & JitPack repository)');
  }
  if (fs.existsSync(SETTINGS_GRADLE)) {
    let sContent = fs.readFileSync(SETTINGS_GRADLE, 'utf8');
    if (sContent.includes('dependencyResolutionManagement')) {
      let sChanged = false;
      if (!sContent.includes('google()')) {
        sContent = sContent.replace(/(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/, `$1\n        google()`);
        sChanged = true;
      }
      if (!sContent.includes('mavenCentral()')) {
        sContent = sContent.replace(/(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/, `$1\n        mavenCentral()`);
        sChanged = true;
      }
      if (!sContent.includes('https://jitpack.io')) {
        sContent = sContent.replace(
          /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/,
          `$1\n        maven { url 'https://jitpack.io' }`
        );
        sChanged = true;
      }
      if (sChanged) fs.writeFileSync(SETTINGS_GRADLE, sContent, 'utf8');
    }
  }
}

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

  if (/namespace\s+["'][^"']+["']/.test(content)) {
    content = content.replace(/namespace\s+["'][^"']+["']/, `namespace "${APP_ID}"`);
  } else {
    content = content.replace(/android\s*\{/, `android {\n    namespace "${APP_ID}"`);
  }
  if (/applicationId\s+["'][^"']+["']/.test(content)) {
    content = content.replace(/applicationId\s+["'][^"']+["']/, `applicationId "${APP_ID}"`);
  }

  // Official SpotyFlow v2.0.2 versionCode 202 & versionName "2.0.2" + minSdk >= 23 for ML Kit
  if (/versionCode\s+\d+/.test(content)) {
    content = content.replace(/versionCode\s+\d+/, 'versionCode 202');
  } else {
    content = content.replace(/defaultConfig\s*\{/, 'defaultConfig {\n        versionCode 202');
  }
  if (/versionName\s+["'][^"']+["']/.test(content)) {
    content = content.replace(/versionName\s+["'][^"']+["']/, 'versionName "2.0.2"');
  } else {
    content = content.replace(/defaultConfig\s*\{/, 'defaultConfig {\n        versionName "2.0.2"');
  }
  content = content.replace(/minSdkVersion\s+(\d+)/, (m, v) => (parseInt(v, 10) < 23 ? 'minSdkVersion 24' : m));

  // Core Library Desugaring (wajib untuk NewPipeExtractor pada Android < 13) + Java 17
  const compileOptsBlock = `compileOptions {\n        coreLibraryDesugaringEnabled true\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }`;
  if (/compileOptions\s*\{[\s\S]*?\}/.test(content)) {
    content = content.replace(/compileOptions\s*\{[\s\S]*?\}/, compileOptsBlock);
  } else {
    content = content.replace(/android\s*\{/, `android {\n    ${compileOptsBlock}`);
  }

  // Production Release BuildType + Safe META-INF packaging exclusions
  const releaseBlock = `release {\n            minifyEnabled false\n            shrinkResources false\n            signingConfig signingConfigs.debug\n        }`;
  if (/buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?\}/.test(content)) {
    content = content.replace(/release\s*\{[\s\S]*?\}/, releaseBlock);
  } else if (/buildTypes\s*\{/.test(content)) {
    content = content.replace(/buildTypes\s*\{/, `buildTypes {\n        ${releaseBlock}`);
  } else {
    content = content.replace(/android\s*\{/, `android {\n    buildTypes {\n        ${releaseBlock}\n    }`);
  }
  if (!content.includes('packaging {') && !content.includes('packagingOptions {')) {
    content = content.replace(
      /buildTypes\s*\{/,
      `packaging {\n        resources {\n            excludes += ['META-INF/LICENSE*', 'META-INF/NOTICE*', 'META-INF/DEPENDENCIES', 'META-INF/INDEX.LIST']\n        }\n    }\n    buildTypes {`
    );
  }

  // Remove incompatible Media3 1.5.x dependencies if present
  content = content.replace(/^\s*implementation\s+["']androidx\.media3:media3-(?:exoplayer|common|session|datasource|database):1\.5\.[^"']*["']\s*$/gm, '');

  // Official SpotyFlow v2.0.2 dependencies: Desugaring 2.0.4 + NewPipeExtractor v0.27.1 + Media3 1.4.1 + Guava + ML Kit Selfie Segmentation
  const requiredDeps = [
    'coreLibraryDesugaring "com.android.tools:desugar_jdk_libs_nio:2.0.4"',
    'implementation "com.github.teamnewpipe:NewPipeExtractor:v0.27.1"',
    'implementation "androidx.media3:media3-common:1.4.1"',
    'implementation "androidx.media3:media3-session:1.4.1"',
    'implementation "androidx.media3:media3-exoplayer:1.4.1"',
    'implementation "androidx.media3:media3-datasource:1.4.1"',
    'implementation "androidx.media3:media3-database:1.4.1"',
    'implementation "com.google.guava:guava:32.1.3-android"',
    'implementation "com.google.mlkit:segmentation-selfie:16.0.0-beta6"',
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
  console.log(`  + Patched android/app/build.gradle (appId=${APP_ID}, v2.0.2/202, Desugaring 2.0.4, NewPipeExtractor v0.27.1, Media3 1.4.1, ML Kit Selfie Segmentation, Java 17)`);
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

  // Register 3 Auralys-Class Native Android Home Screen Widgets (4x1 Mini Glass, 4x2 Album Card, 4x2 Live Lyrics)
  // First strip old widget blocks if re-patching an existing Android folder so labels & 3rd widget are always fresh
  xml = xml.replace(/\s*<receiver[^>]*android:name="\.(SpotyFlowWidgetProvider|SpotyFlowWidgetLargeProvider|SpotyFlowWidgetLyricsProvider)"[\s\S]*?<\/receiver>\s*/g, '\n');
  const widgetReceiversBlock = `
        <receiver
            android:name=".SpotyFlowWidgetProvider"
            android:exported="true"
            android:label="SpotyFlow Mini Glass (4×1)">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="${APP_ID}.WIDGET_CMD" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/widget_spotyflow_small_info" />
        </receiver>

        <receiver
            android:name=".SpotyFlowWidgetLargeProvider"
            android:exported="true"
            android:label="SpotyFlow Album Card (4×2)">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="${APP_ID}.WIDGET_CMD" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/widget_spotyflow_large_info" />
        </receiver>

        <receiver
            android:name=".SpotyFlowWidgetLyricsProvider"
            android:exported="true"
            android:label="SpotyFlow Live Lyrics (4×2)">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="${APP_ID}.WIDGET_CMD" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/widget_spotyflow_lyrics_info" />
        </receiver>
    `;
  xml = xml.replace('</application>', `${widgetReceiversBlock}\n    </application>`);

  fs.writeFileSync(MANIFEST_XML, xml, 'utf8');
  console.log('  + Patched AndroidManifest.xml (14 Spotify permissions, appCategory=audio, Media3 MediaSessionService, MediaButtonReceiver & 3 Auralys Widgets)');
}

function writeJavaAndResSources() {
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
  fs.mkdirSync(RES_XML_DIR, { recursive: true });

  for (const legacy of ['NativeYouTubeResolver.java', 'SpotyFlowMediaService.java', 'SpotyFlowMediaPlugin.java']) {
    const p = path.join(JAVA_PKG_DIR, legacy);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      console.log('  + Removed legacy Java file:', legacy);
    }
  }

  // 9 Native Java classes (WebView, FastResolver, NewPipeEngine, DepthEngine ML Kit, PlaybackService, MainActivity, 3 Auralys Widgets)
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), SPOTYFLOW_WEBVIEW_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowFastResolver.java'), SPOTYFLOW_FAST_RESOLVER_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowNewPipeEngine.java'), SPOTYFLOW_NEWPIPE_ENGINE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowDepthEngine.java'), SPOTYFLOW_DEPTH_ENGINE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), SPOTYFLOW_PLAYBACK_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), MAIN_ACTIVITY_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetProvider.java'), SPOTYFLOW_WIDGET_PROVIDER_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLargeProvider.java'), SPOTYFLOW_WIDGET_LARGE_PROVIDER_JAVA, 'utf8');
  fs.writeFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLyricsProvider.java'), SPOTYFLOW_WIDGET_LYRICS_PROVIDER_JAVA, 'utf8');

  // WebView layouts + 3 Auralys Home Screen Widget layouts
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), BRIDGE_LAYOUT_MAIN_XML, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_small.xml'), WIDGET_SPOTYFLOW_SMALL_XML, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_large.xml'), WIDGET_SPOTYFLOW_LARGE_XML, 'utf8');
  fs.writeFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_lyrics.xml'), WIDGET_SPOTYFLOW_LYRICS_XML, 'utf8');

  // Notification + Widget drawables
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'), IC_STAT_MUSIC_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'widget_bg_dark.xml'), WIDGET_BG_DARK_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'widget_bg_adaptive.xml'), WIDGET_BG_ADAPTIVE_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'widget_bg_stroke_overlay.xml'), WIDGET_BG_STROKE_OVERLAY_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'widget_cover_bg.xml'), WIDGET_COVER_BG_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'widget_btn_play_bg.xml'), WIDGET_BTN_PLAY_BG_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_widget_prev.xml'), IC_WIDGET_PREV_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_widget_next.xml'), IC_WIDGET_NEXT_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_widget_play.xml'), IC_WIDGET_PLAY_XML, 'utf8');
  fs.writeFileSync(path.join(RES_DRAWABLE_DIR, 'ic_widget_pause.xml'), IC_WIDGET_PAUSE_XML, 'utf8');

  // AppWidget provider metadata XMLs
  fs.writeFileSync(path.join(RES_XML_DIR, 'widget_spotyflow_small_info.xml'), WIDGET_SPOTYFLOW_SMALL_INFO_XML, 'utf8');
  fs.writeFileSync(path.join(RES_XML_DIR, 'widget_spotyflow_large_info.xml'), WIDGET_SPOTYFLOW_LARGE_INFO_XML, 'utf8');
  fs.writeFileSync(path.join(RES_XML_DIR, 'widget_spotyflow_lyrics_info.xml'), WIDGET_SPOTYFLOW_LYRICS_INFO_XML, 'utf8');

  console.log(`  + Written 9 Java classes to ${path.relative(ROOT, JAVA_PKG_DIR)} (package ${APP_ID}) + WebView layouts + 3 Auralys Widgets & drawables`);
}

function verifyPatchedProject() {
  const mustExist = [
    ROOT_BUILD_GRADLE,
    BUILD_GRADLE,
    MANIFEST_XML,
    path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowFastResolver.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowNewPipeEngine.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowDepthEngine.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'),
    path.join(JAVA_PKG_DIR, 'MainActivity.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetProvider.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLargeProvider.java'),
    path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLyricsProvider.java'),
    path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'),
    path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'),
    path.join(RES_LAYOUT_DIR, 'widget_spotyflow_small.xml'),
    path.join(RES_LAYOUT_DIR, 'widget_spotyflow_large.xml'),
    path.join(RES_LAYOUT_DIR, 'widget_spotyflow_lyrics.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_stat_music.xml'),
    path.join(RES_DRAWABLE_DIR, 'widget_bg_dark.xml'),
    path.join(RES_DRAWABLE_DIR, 'widget_bg_adaptive.xml'),
    path.join(RES_DRAWABLE_DIR, 'widget_bg_stroke_overlay.xml'),
    path.join(RES_DRAWABLE_DIR, 'widget_cover_bg.xml'),
    path.join(RES_DRAWABLE_DIR, 'widget_btn_play_bg.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_widget_prev.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_widget_next.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_widget_play.xml'),
    path.join(RES_DRAWABLE_DIR, 'ic_widget_pause.xml'),
    path.join(RES_XML_DIR, 'widget_spotyflow_small_info.xml'),
    path.join(RES_XML_DIR, 'widget_spotyflow_large_info.xml'),
    path.join(RES_XML_DIR, 'widget_spotyflow_lyrics_info.xml'),
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

  const rootGradle = fs.readFileSync(ROOT_BUILD_GRADLE, 'utf8');
  const variablesGradle = fs.existsSync(VARIABLES_GRADLE) ? fs.readFileSync(VARIABLES_GRADLE, 'utf8') : '';
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const manifest = fs.readFileSync(MANIFEST_XML, 'utf8');
  const np = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowNewPipeEngine.java'), 'utf8');
  const fast = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowFastResolver.java'), 'utf8');
  const depth = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowDepthEngine.java'), 'utf8');
  const svc = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowPlaybackService.java'), 'utf8');
  const act = fs.readFileSync(path.join(JAVA_PKG_DIR, 'MainActivity.java'), 'utf8');
  const webv = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWebView.java'), 'utf8');
  const wSmall = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetProvider.java'), 'utf8');
  const wLarge = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLargeProvider.java'), 'utf8');
  const wLyrics = fs.readFileSync(path.join(JAVA_PKG_DIR, 'SpotyFlowWidgetLyricsProvider.java'), 'utf8');
  const wLayoutSm = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_small.xml'), 'utf8');
  const wLayoutLg = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_large.xml'), 'utf8');
  const wLayoutLy = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'widget_spotyflow_lyrics.xml'), 'utf8');
  const capLayout = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'capacitor_bridge_layout_main.xml'), 'utf8');
  const layout = fs.readFileSync(path.join(RES_LAYOUT_DIR, 'bridge_layout_main.xml'), 'utf8');

  const pkgDecl = `package ${APP_ID};`;
  const checks = [
    [rootGradle.includes('https://jitpack.io') && rootGradle.includes('google()') && rootGradle.includes('mavenCentral()'), 'android/build.gradle missing JitPack, google(), or mavenCentral()'],
    [!variablesGradle || (variablesGradle.includes('compileSdkVersion = 34') && variablesGradle.includes('targetSdkVersion = 34')), 'variables.gradle missing compileSdk/targetSdk = 34'],
    [gradle.includes(`namespace "${APP_ID}"`), `build.gradle missing namespace "${APP_ID}"`],
    [gradle.includes(`applicationId "${APP_ID}"`), `build.gradle missing applicationId "${APP_ID}"`],
    [gradle.includes('versionCode 202') && gradle.includes('versionName "2.0.2"'), 'build.gradle missing versionCode 202 / versionName "2.0.2"'],
    [gradle.includes('coreLibraryDesugaringEnabled true'), 'build.gradle missing coreLibraryDesugaringEnabled true'],
    [gradle.includes('com.android.tools:desugar_jdk_libs_nio:2.0.4'), 'build.gradle missing desugar_jdk_libs_nio:2.0.4'],
    [gradle.includes('com.github.teamnewpipe:NewPipeExtractor:v0.27.1'), 'build.gradle missing NewPipeExtractor:v0.27.1'],
    [gradle.includes('com.google.mlkit:segmentation-selfie:16.0.0-beta6'), 'build.gradle missing ML Kit segmentation-selfie:16.0.0-beta6'],
    [gradle.includes('androidx.media3:media3-common:1.4.1') && gradle.includes('androidx.media3:media3-session:1.4.1') && gradle.includes('androidx.media3:media3-exoplayer:1.4.1') && gradle.includes('androidx.media3:media3-datasource:1.4.1') && gradle.includes('androidx.media3:media3-database:1.4.1'), 'build.gradle missing Media3 1.4.1 ExoPlayer stack'],
    [gradle.includes('com.google.guava:guava:32.1.3-android'), 'build.gradle missing guava'],
    [gradle.includes('JavaVersion.VERSION_17'), 'build.gradle missing Java 17'],
    [gradle.includes('minifyEnabled false') && gradle.includes('shrinkResources false') && gradle.includes('signingConfig signingConfigs.debug'), 'build.gradle missing production release buildType config'],
    [fast.startsWith(pkgDecl) && np.startsWith(pkgDecl) && depth.startsWith(pkgDecl) && svc.startsWith(pkgDecl) && act.startsWith(pkgDecl) && webv.startsWith(pkgDecl) && wSmall.startsWith(pkgDecl) && wLarge.startsWith(pkgDecl) && wLyrics.startsWith(pkgDecl), `Java files missing ${pkgDecl}`],
    [depth.includes('SelfieSegmenterOptions.SINGLE_IMAGE_MODE') && depth.includes('segmentSubjectAsync') && depth.includes('buffer.rewind()'), 'SpotyFlowDepthEngine missing ML Kit SINGLE_IMAGE_MODE or smoothstep mask'],
    [fast.includes('ANDROID_VR') && fast.includes('searchVideoIdFast') && fast.includes('resolveFast') && !fast.includes('okhttp3'), 'SpotyFlowFastResolver missing ANDROID_VR or native search'],
    [np.includes('s.getContent()') && !np.includes('s.getUrl()') && !np.includes('okhttp3') && np.includes('HttpURLConnection'), 'SpotyFlowNewPipeEngine must use pure HttpURLConnection & getContent()'],
    [svc.includes('SimpleCache') && svc.includes('DefaultLoadControl') && svc.includes('setBufferDurationsMs(25000, 60000, 900, 1800)') && svc.includes('2000L') && svc.includes('updateLyricsWidgetsOnly') && svc.includes('C.WAKE_MODE_NETWORK') && svc.includes('hasRetriedWithNewPipe'), 'SpotyFlowPlaybackService missing v2.0.2 4G LoadControl, 2000ms ticker, or updateLyricsWidgetsOnly'],
    [svc.includes('dispatchLyricUpdate') && svc.includes('dominantColorInt') && svc.includes('islandLyricsEnabled'), 'SpotyFlowPlaybackService missing Live Island Lyrics or Dominant Color'],
    [wSmall.includes('PendingIntent.FLAG_IMMUTABLE') && wSmall.includes('updateLyricsWidgetsOnly') && wSmall.includes('partiallyUpdateAppWidget') && wSmall.includes('SpotyFlowWidgetLyricsProvider') && !wLayoutSm.includes('ConstraintLayout') && !wLayoutLg.includes('ConstraintLayout') && !wLayoutLy.includes('ConstraintLayout') && wLayoutLy.includes('widget_live_lyric'), '3 Auralys Widgets RemoteViews or updateLyricsWidgetsOnly rule violated'],
    [act.includes('playNativeTrack') && act.includes('prefetchTrackMeta') && act.includes('savePosterToGallery') && act.includes('sharePosterImage') && act.includes('segmentPhotoDepthAsync') && act.includes('hasDepthEngine') && act.includes('nativeControl') && act.includes('updateLyricLine') && act.includes('downloadOfflineTrack') && act.includes('hasOfflineTrack') && act.includes('deleteOfflineTrack') && act.includes('getOfflineTracksJson'), 'MainActivity missing v2.0.2 JS bridge methods'],
    [manifest.includes('SpotyFlowWidgetProvider') && manifest.includes('SpotyFlowWidgetLargeProvider') && manifest.includes('SpotyFlowWidgetLyricsProvider'), 'Manifest missing 3 Auralys Widget receivers'],
    [capLayout.includes(`<${APP_ID}.SpotyFlowWebView`) && layout.includes(`<${APP_ID}.SpotyFlowWebView`), `WebView layouts missing <${APP_ID}.SpotyFlowWebView`],
    [svc.includes('serviceStarted') && act.includes('isActivityInForeground'), 'Service/MainActivity missing foreground service promotion guard'],
    [act.includes('getSystemStatus()') && act.includes('openNotificationSettings()') && act.includes('openBatterySettings()') && act.includes('clearHttpCache()'), 'MainActivity missing 4 native utility bridge methods'],
    [webv.includes('onWindowVisibilityChanged') && webv.includes('dispatchWindowVisibilityChanged') && webv.includes('onVisibilityChanged') && webv.includes('SpotyFlowPlaybackService.isPlaying'), 'SpotyFlowWebView missing full background visibility & pause overrides'],
    [manifest.includes('android:appCategory="audio"'), 'Manifest missing appCategory="audio"'],
    [manifest.includes('android:launchMode="singleTask"'), 'Manifest missing launchMode="singleTask" on MainActivity'],
    [manifest.includes('android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"'), 'Manifest missing full configChanges on MainActivity'],
    [manifest.includes('androidx.media3.session.MediaSessionService') && manifest.includes('androidx.media3.session.MediaButtonReceiver'), 'Manifest missing MediaSessionService or MediaButtonReceiver'],
    [!manifest.includes('SpotyFlowMediaService') && !manifest.includes('SYSTEM_ALERT_WINDOW'), 'Manifest contains forbidden legacy service or SYSTEM_ALERT_WINDOW'],
    [svc.includes('extends MediaSessionService') && svc.includes('extends SimpleBasePlayer') && svc.includes('@UnstableApi'), 'Service must use SimpleBasePlayer + MediaSessionService + @UnstableApi'],
    [svc.includes('ForwardingPlayer') && svc.includes('hasNextMediaItem') && svc.includes('hasPreviousMediaItem'), 'Service missing ForwardingPlayer Next/Prev overrides'],
    [svc.includes('spotyflow_general') && svc.includes('spotyflow_playback') && svc.includes('spotyflow_music') && svc.includes('spotyflow_downloads'), 'Service missing 4 notification channels'],
    [svc.includes('PARTIAL_WAKE_LOCK') && svc.includes('wakeLock.acquire()') && svc.includes('ACTION_AUDIO_BECOMING_NOISY'), 'Service missing indefinite WakeLock or Noisy receiver'],
    [act.includes('"SpotyFlowMediaBridge"') && act.includes('sendMediaActionToJs') && act.includes('setMediaPlaybackRequiresUserGesture(false)') && act.includes('setDomStorageEnabled(true)'), 'MainActivity missing SpotyFlowMediaBridge or WebView settings'],
    [act.includes('RENDERER_PRIORITY_IMPORTANT') && act.includes('moveTaskToBack(true)') && act.includes('__sfSetAppBackgrounded') && !act.includes('LAYER_TYPE_HARDWARE'), 'MainActivity missing renderer priority/moveTaskToBack or has forbidden LAYER_TYPE_HARDWARE'],
    [(manifest.match(/android:hardwareAccelerated="true"/g) || []).length >= 2, 'Manifest missing android:hardwareAccelerated="true" on <application> and <activity>'],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error('[SpotyFlow Media3 Patcher] VERIFY FAILED:', msg);
      process.exit(1);
    }
  }
  console.log(`  + Strict self-verification passed (${checks.length}/${checks.length} SpotyFlow v2.0.2 checks)`);
}

function main() {
  try {
    if (!fs.existsSync(ANDROID_DIR)) {
      throw new Error('Folder android/ belum ada. Jalankan `npx cap add android && npx cap sync android` terlebih dahulu.');
    }
    console.log(`[SpotyFlow Media3 Patcher] Injecting SpotyFlow v2.0.2 (Zero-Stutter 4G ExoPlayer + ML Kit Offline Depth Engine + FastResolver + NewPipe + 3 Widgets, appId=${APP_ID})...`);
    patchRootBuildGradle();
    patchVariablesGradle();
    patchBuildGradle();
    patchAndroidManifest();
    writeJavaAndResSources();
    verifyPatchedProject();
    console.log('[SpotyFlow Media3 Patcher] SELESAI — siap kompilasi Gradle 8 / Java 17 Release v2.0.2!');
  } catch (err) {
    console.error('[SpotyFlow Media3 Patcher] ERROR:', err?.message || err);
    process.exit(1);
  }
}

main();
