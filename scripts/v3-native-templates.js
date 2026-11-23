'use strict';

// =========================================================================
// SpotyFlow v3.0.0 Native Templates:
// - 5 Android AppWidget sizes (1x1, 2x2, 2x4, 4x1, 4x2)
// - SpotyFlowWidgetRenderer.java (Dynamic Glass/Lens/Corner Canvas Renderer)
// - SpotyFlowBaseWidgetProvider.java + 5 Subclass Providers
// - SpotyFlowIslandOverlayService.java (Opt-in Floating Dynamic Island)
// =========================================================================

const IC_WIDGET_HEART_OUTLINE_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="20dp"
    android:height="20dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M20.84,4.61a5.5,5.5 0,0 0,-7.78 0L12,5.67l-1.06,-1.06a5.5,5.5 0,0 0,-7.78 7.78l1.06,1.06L12,21.23l7.78,-7.78 1.06,-1.06a5.5,5.5 0,0 0,0 -7.78z"/>
</vector>
`;

const IC_WIDGET_HEART_FILLED_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="20dp"
    android:height="20dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FB7185"
        android:pathData="M20.84,4.61a5.5,5.5 0,0 0,-7.78 0L12,5.67l-1.06,-1.06a5.5,5.5 0,0 0,-7.78 7.78l1.06,1.06L12,21.23l7.78,-7.78 1.06,-1.06a5.5,5.5 0,0 0,0 -7.78z"/>
</vector>
`;

const WIDGET_PROGRESS_DRAWABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:id="@android:id/background">
        <shape android:shape="rectangle">
            <corners android:radius="99dp" />
            <solid android:color="#38FFFFFF" />
        </shape>
    </item>
    <item android:id="@android:id/progress">
        <clip>
            <shape android:shape="rectangle">
                <corners android:radius="99dp" />
                <solid android:color="#FFFFFFFF" />
            </shape>
        </clip>
    </item>
</layer-list>
`;

// 1x1 Widget Layout (RemoteViews-safe FrameLayout ONLY)
const WIDGET_PLAYER_1X1_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="fitXY"
        android:contentDescription="Widget background" />

    <ImageView
        android:id="@+id/widget_cover"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:layout_margin="4dp"
        android:scaleType="centerCrop"
        android:src="@mipmap/ic_launcher"
        android:contentDescription="Album cover" />

    <ImageButton
        android:id="@+id/widget_btn_play_pause"
        android:layout_width="40dp"
        android:layout_height="40dp"
        android:layout_gravity="center"
        android:background="@drawable/widget_btn_play_bg"
        android:src="@drawable/ic_widget_play"
        android:padding="9dp"
        android:scaleType="fitCenter"
        android:contentDescription="Play or pause" />
</FrameLayout>
`;

// 2x2 Widget Layout
const WIDGET_PLAYER_2X2_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="fitXY"
        android:contentDescription="Widget background" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:padding="10dp"
        android:gravity="center_vertical">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="46dp"
                android:layout_height="46dp"
                android:scaleType="centerCrop"
                android:src="@mipmap/ic_launcher"
                android:contentDescription="Album cover" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical"
                android:layout_marginStart="8dp">

                <TextView
                    android:id="@+id/widget_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:text="SpotyFlow"
                    android:textColor="#FFFFFF"
                    android:textSize="13sp"
                    android:textStyle="bold"
                    android:maxLines="1"
                    android:ellipsize="end" />

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:text="Ketuk untuk memutar"
                    android:textColor="#CCFFFFFF"
                    android:textSize="10.5sp"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>
        </LinearLayout>

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center"
            android:layout_marginTop="8dp">

            <ImageButton
                android:id="@+id/widget_btn_like"
                android:layout_width="28dp"
                android:layout_height="28dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_heart_outline"
                android:padding="4dp"
                android:scaleType="fitCenter"
                android:contentDescription="Like" />

            <ImageButton
                android:id="@+id/widget_btn_prev"
                android:layout_width="30dp"
                android:layout_height="30dp"
                android:layout_marginStart="4dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_prev"
                android:padding="5dp"
                android:scaleType="fitCenter"
                android:contentDescription="Previous" />

            <ImageButton
                android:id="@+id/widget_btn_play_pause"
                android:layout_width="36dp"
                android:layout_height="36dp"
                android:layout_marginStart="4dp"
                android:layout_marginEnd="4dp"
                android:background="@drawable/widget_btn_play_bg"
                android:src="@drawable/ic_widget_play"
                android:padding="8dp"
                android:scaleType="fitCenter"
                android:contentDescription="Play or pause" />

            <ImageButton
                android:id="@+id/widget_btn_next"
                android:layout_width="30dp"
                android:layout_height="30dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_next"
                android:padding="5dp"
                android:scaleType="fitCenter"
                android:contentDescription="Next" />
        </LinearLayout>

        <LinearLayout
            android:id="@+id/widget_progress_row"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical"
            android:layout_marginTop="6dp">

            <TextView
                android:id="@+id/widget_time_cur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="9.5sp" />

            <ProgressBar
                android:id="@+id/widget_progress"
                style="?android:attr/progressBarStyleHorizontal"
                android:layout_width="0dp"
                android:layout_height="4dp"
                android:layout_weight="1"
                android:layout_marginStart="5dp"
                android:layout_marginEnd="5dp"
                android:max="100"
                android:progress="30"
                android:progressDrawable="@drawable/widget_progress_drawable" />

            <TextView
                android:id="@+id/widget_time_dur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="9.5sp" />
        </LinearLayout>
    </LinearLayout>
</FrameLayout>
`;

// 2x4 Tall Portrait Widget Layout
const WIDGET_PLAYER_2X4_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="fitXY"
        android:contentDescription="Widget background" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:padding="12dp"
        android:gravity="center_horizontal">

        <ImageView
            android:id="@+id/widget_cover"
            android:layout_width="116dp"
            android:layout_height="116dp"
            android:scaleType="centerCrop"
            android:src="@mipmap/ic_launcher"
            android:contentDescription="Album cover" />

        <TextView
            android:id="@+id/widget_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="10dp"
            android:gravity="center"
            android:text="SpotyFlow"
            android:textColor="#FFFFFF"
            android:textSize="14sp"
            android:textStyle="bold"
            android:maxLines="1"
            android:ellipsize="end" />

        <TextView
            android:id="@+id/widget_artist"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="2dp"
            android:gravity="center"
            android:text="Ketuk untuk memutar"
            android:textColor="#CCFFFFFF"
            android:textSize="11sp"
            android:maxLines="1"
            android:ellipsize="end" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center"
            android:layout_marginTop="12dp">

            <ImageButton
                android:id="@+id/widget_btn_like"
                android:layout_width="30dp"
                android:layout_height="30dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_heart_outline"
                android:padding="4dp"
                android:scaleType="fitCenter"
                android:contentDescription="Like" />

            <ImageButton
                android:id="@+id/widget_btn_prev"
                android:layout_width="32dp"
                android:layout_height="32dp"
                android:layout_marginStart="4dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_prev"
                android:padding="5dp"
                android:scaleType="fitCenter"
                android:contentDescription="Previous" />

            <ImageButton
                android:id="@+id/widget_btn_play_pause"
                android:layout_width="40dp"
                android:layout_height="40dp"
                android:layout_marginStart="6dp"
                android:layout_marginEnd="6dp"
                android:background="@drawable/widget_btn_play_bg"
                android:src="@drawable/ic_widget_play"
                android:padding="9dp"
                android:scaleType="fitCenter"
                android:contentDescription="Play or pause" />

            <ImageButton
                android:id="@+id/widget_btn_next"
                android:layout_width="32dp"
                android:layout_height="32dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_next"
                android:padding="5dp"
                android:scaleType="fitCenter"
                android:contentDescription="Next" />
        </LinearLayout>

        <LinearLayout
            android:id="@+id/widget_progress_row"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical"
            android:layout_marginTop="10dp">

            <TextView
                android:id="@+id/widget_time_cur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="10sp" />

            <ProgressBar
                android:id="@+id/widget_progress"
                style="?android:attr/progressBarStyleHorizontal"
                android:layout_width="0dp"
                android:layout_height="4dp"
                android:layout_weight="1"
                android:layout_marginStart="6dp"
                android:layout_marginEnd="6dp"
                android:max="100"
                android:progress="30"
                android:progressDrawable="@drawable/widget_progress_drawable" />

            <TextView
                android:id="@+id/widget_time_dur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="10sp" />
        </LinearLayout>
    </LinearLayout>
</FrameLayout>
`;

// 4x1 Capsule Widget Layout
const WIDGET_PLAYER_4X1_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="fitXY"
        android:contentDescription="Widget background" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingStart="10dp"
        android:paddingEnd="10dp"
        android:paddingTop="6dp"
        android:paddingBottom="6dp">

        <ImageView
            android:id="@+id/widget_cover"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:scaleType="centerCrop"
            android:src="@mipmap/ic_launcher"
            android:contentDescription="Album cover" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical"
            android:layout_marginStart="10dp"
            android:layout_marginEnd="6dp">

            <TextView
                android:id="@+id/widget_title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="SpotyFlow"
                android:textColor="#FFFFFF"
                android:textSize="13.5sp"
                android:textStyle="bold"
                android:maxLines="1"
                android:ellipsize="end" />

            <TextView
                android:id="@+id/widget_artist"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="Ketuk untuk memutar"
                android:textColor="#CCFFFFFF"
                android:textSize="11sp"
                android:maxLines="1"
                android:ellipsize="end" />
        </LinearLayout>

        <ImageButton
            android:id="@+id/widget_btn_like"
            android:layout_width="30dp"
            android:layout_height="30dp"
            android:background="@android:color/transparent"
            android:src="@drawable/ic_widget_heart_outline"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:contentDescription="Like" />

        <ImageButton
            android:id="@+id/widget_btn_prev"
            android:layout_width="30dp"
            android:layout_height="30dp"
            android:background="@android:color/transparent"
            android:src="@drawable/ic_widget_prev"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:contentDescription="Previous" />

        <ImageButton
            android:id="@+id/widget_btn_play_pause"
            android:layout_width="36dp"
            android:layout_height="36dp"
            android:layout_marginStart="3dp"
            android:layout_marginEnd="3dp"
            android:background="@drawable/widget_btn_play_bg"
            android:src="@drawable/ic_widget_play"
            android:padding="8dp"
            android:scaleType="fitCenter"
            android:contentDescription="Play or pause" />

        <ImageButton
            android:id="@+id/widget_btn_next"
            android:layout_width="30dp"
            android:layout_height="30dp"
            android:background="@android:color/transparent"
            android:src="@drawable/ic_widget_next"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:contentDescription="Next" />
    </LinearLayout>
</FrameLayout>
`;

// 4x2 Hero Widget Layout (with Streak Flame Badge + Full Progress Row)
const WIDGET_PLAYER_4X2_XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="fitXY"
        android:contentDescription="Widget background" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:padding="12dp"
        android:gravity="center_vertical">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="76dp"
                android:layout_height="76dp"
                android:scaleType="centerCrop"
                android:src="@mipmap/ic_launcher"
                android:contentDescription="Album cover" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical"
                android:layout_marginStart="12dp">

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:orientation="horizontal"
                    android:gravity="center_vertical">

                    <TextView
                        android:id="@+id/widget_title"
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:text="SpotyFlow"
                        android:textColor="#FFFFFF"
                        android:textSize="15sp"
                        android:textStyle="bold"
                        android:maxLines="1"
                        android:ellipsize="end" />

                    <TextView
                        android:id="@+id/widget_streak_badge"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:layout_marginStart="6dp"
                        android:text="🔥 1"
                        android:textColor="#FDBA74"
                        android:textSize="11.5sp"
                        android:textStyle="bold" />
                </LinearLayout>

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="1dp"
                    android:text="Ketuk untuk memutar"
                    android:textColor="#CCFFFFFF"
                    android:textSize="12sp"
                    android:maxLines="1"
                    android:ellipsize="end" />

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:orientation="horizontal"
                    android:gravity="center_vertical"
                    android:layout_marginTop="8dp">

                    <ImageButton
                        android:id="@+id/widget_btn_like"
                        android:layout_width="32dp"
                        android:layout_height="32dp"
                        android:background="@android:color/transparent"
                        android:src="@drawable/ic_widget_heart_outline"
                        android:padding="5dp"
                        android:scaleType="fitCenter"
                        android:contentDescription="Like" />

                    <ImageButton
                        android:id="@+id/widget_btn_prev"
                        android:layout_width="34dp"
                        android:layout_height="34dp"
                        android:layout_marginStart="8dp"
                        android:background="@android:color/transparent"
                        android:src="@drawable/ic_widget_prev"
                        android:padding="6dp"
                        android:scaleType="fitCenter"
                        android:contentDescription="Previous" />

                    <ImageButton
                        android:id="@+id/widget_btn_play_pause"
                        android:layout_width="40dp"
                        android:layout_height="40dp"
                        android:layout_marginStart="8dp"
                        android:layout_marginEnd="8dp"
                        android:background="@drawable/widget_btn_play_bg"
                        android:src="@drawable/ic_widget_play"
                        android:padding="9dp"
                        android:scaleType="fitCenter"
                        android:contentDescription="Play or pause" />

                    <ImageButton
                        android:id="@+id/widget_btn_next"
                        android:layout_width="34dp"
                        android:layout_height="34dp"
                        android:background="@android:color/transparent"
                        android:src="@drawable/ic_widget_next"
                        android:padding="6dp"
                        android:scaleType="fitCenter"
                        android:contentDescription="Next" />
                </LinearLayout>
            </LinearLayout>
        </LinearLayout>

        <LinearLayout
            android:id="@+id/widget_progress_row"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical"
            android:layout_marginTop="10dp">

            <TextView
                android:id="@+id/widget_time_cur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="10.5sp" />

            <ProgressBar
                android:id="@+id/widget_progress"
                style="?android:attr/progressBarStyleHorizontal"
                android:layout_width="0dp"
                android:layout_height="5dp"
                android:layout_weight="1"
                android:layout_marginStart="8dp"
                android:layout_marginEnd="8dp"
                android:max="100"
                android:progress="35"
                android:progressDrawable="@drawable/widget_progress_drawable" />

            <TextView
                android:id="@+id/widget_time_dur"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="0:00"
                android:textColor="#CCFFFFFF"
                android:textSize="10.5sp" />
        </LinearLayout>
    </LinearLayout>
</FrameLayout>
`;

function makeWidgetInfoXml(layoutName, cellW, cellH, minW, minH) {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:initialLayout="@layout/${layoutName}"
    android:minWidth="${minW}"
    android:minHeight="${minH}"
    android:targetCellWidth="${cellW}"
    android:targetCellHeight="${cellH}"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="1800000"
    android:widgetCategory="home_screen" />
`;
}

const WIDGET_INFOS = {
  'widget_player_1x1_info.xml': makeWidgetInfoXml('widget_player_1x1', 1, 1, '56dp', '56dp'),
  'widget_player_2x2_info.xml': makeWidgetInfoXml('widget_player_2x2', 2, 2, '110dp', '110dp'),
  'widget_player_2x4_info.xml': makeWidgetInfoXml('widget_player_2x4', 2, 4, '110dp', '250dp'),
  'widget_player_4x1_info.xml': makeWidgetInfoXml('widget_player_4x1', 4, 1, '250dp', '56dp'),
  'widget_player_4x2_info.xml': makeWidgetInfoXml('widget_player_4x2', 4, 2, '250dp', '110dp'),
};

function getWidgetRendererJava(APP_ID) {
  return `package ${APP_ID};

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;

import org.json.JSONObject;

public final class SpotyFlowWidgetRenderer {
    private static final String PREFS_NAME = "sf_widget_prefs";
    private static final String PREF_JSON_KEY = "widget_cfg_json";

    public static final class WidgetConfig {
        public String style = "glass";
        public String accentMode = "cover";
        public String accentColorHex = "#7C3AED";
        public int glassShine = 70;
        public int glassThickness = 60;
        public int cornerRadiusPct = 66;
        public String coverShape = "rounded";
        public String textSize = "medium";
        public String playBtnStyle = "round";
        public boolean showCover = true;
        public boolean showProgress = true;
        public boolean showTime = true;
        public boolean showLike = true;
        public boolean showPrevNext = true;
        public boolean showStreak = true;
    }

    public static WidgetConfig loadConfig(Context ctx) {
        WidgetConfig cfg = new WidgetConfig();
        if (ctx == null) return cfg;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = sp.getString(PREF_JSON_KEY, "");
            if (raw != null && !raw.isEmpty()) {
                JSONObject o = new JSONObject(raw);
                cfg.style = o.optString("style", cfg.style);
                cfg.accentMode = o.optString("accentMode", cfg.accentMode);
                cfg.accentColorHex = o.optString("accentColorHex", cfg.accentColorHex);
                cfg.glassShine = clamp(o.optInt("glassShine", cfg.glassShine), 0, 100);
                cfg.glassThickness = clamp(o.optInt("glassThickness", cfg.glassThickness), 0, 100);
                cfg.cornerRadiusPct = clamp(o.optInt("cornerRadiusPct", cfg.cornerRadiusPct), 0, 100);
                cfg.coverShape = o.optString("coverShape", cfg.coverShape);
                cfg.textSize = o.optString("textSize", cfg.textSize);
                cfg.playBtnStyle = o.optString("playBtnStyle", cfg.playBtnStyle);
                cfg.showCover = o.optBoolean("showCover", true);
                cfg.showProgress = o.optBoolean("showProgress", true);
                cfg.showTime = o.optBoolean("showTime", true);
                cfg.showLike = o.optBoolean("showLike", true);
                cfg.showPrevNext = o.optBoolean("showPrevNext", true);
                cfg.showStreak = o.optBoolean("showStreak", true);
            }
        } catch (Throwable ignored) {
        }
        return cfg;
    }

    public static String getConfigJson(Context ctx) {
        WidgetConfig cfg = loadConfig(ctx);
        try {
            JSONObject o = new JSONObject();
            o.put("style", cfg.style);
            o.put("accentMode", cfg.accentMode);
            o.put("accentColorHex", cfg.accentColorHex);
            o.put("glassShine", cfg.glassShine);
            o.put("glassThickness", cfg.glassThickness);
            o.put("cornerRadiusPct", cfg.cornerRadiusPct);
            o.put("coverShape", cfg.coverShape);
            o.put("textSize", cfg.textSize);
            o.put("playBtnStyle", cfg.playBtnStyle);
            o.put("showCover", cfg.showCover);
            o.put("showProgress", cfg.showProgress);
            o.put("showTime", cfg.showTime);
            o.put("showLike", cfg.showLike);
            o.put("showPrevNext", cfg.showPrevNext);
            o.put("showStreak", cfg.showStreak);
            return o.toString();
        } catch (Throwable ignored) {
            return "{}";
        }
    }

    public static void saveConfigJson(Context ctx, String jsonStr) {
        if (ctx == null || jsonStr == null) return;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            sp.edit().putString(PREF_JSON_KEY, jsonStr).apply();
        } catch (Throwable ignored) {
        }
    }

    public static int resolveAccentColor(WidgetConfig cfg, int dominantColor) {
        if ("custom".equals(cfg.accentMode) && cfg.accentColorHex != null) {
            try {
                return Color.parseColor(cfg.accentColorHex);
            } catch (Throwable ignored) {
            }
        }
        return dominantColor != 0 ? dominantColor : Color.rgb(109, 40, 217);
    }

    public static Bitmap renderBackgroundBitmap(int w, int h, WidgetConfig cfg, Bitmap coverBmp, int dominantColor) {
        Bitmap out = Bitmap.createBitmap(Math.max(16, w), Math.max(16, h), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        float maxRad = Math.min(w, h) * 0.48f;
        float radius = (clamp(cfg.cornerRadiusPct, 0, 100) / 100f) * maxRad;

        RectF rect = new RectF(0, 0, w, h);
        Path clipPath = new Path();
        clipPath.addRoundRect(rect, radius, radius, Path.Direction.CW);
        canvas.save();
        canvas.clipPath(clipPath);

        int accent = resolveAccentColor(cfg, dominantColor);
        int ar = Color.red(accent);
        int ag = Color.green(accent);
        int ab = Color.blue(accent);
        String style = cfg.style != null ? cfg.style : "glass";

        if ("light".equals(style)) {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(Color.argb(242, 248, 250, 252));
            canvas.drawRect(rect, p);
        } else if ("dark".equals(style)) {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(Color.argb(235, 20, 22, 29));
            canvas.drawRect(rect, p);
        } else if ("cover_color".equals(style)) {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            int c1 = Color.argb(242, Math.max(16, ar), Math.max(16, ag), Math.max(16, ab));
            int c2 = Color.argb(246, Math.max(8, ar / 3), Math.max(8, ag / 3), Math.max(12, ab / 3));
            p.setShader(new LinearGradient(0, 0, w, h, c1, c2, Shader.TileMode.CLAMP));
            canvas.drawRect(rect, p);
        } else {
            // "glass" or "clear_glass"
            boolean isClear = "clear_glass".equals(style);
            if (coverBmp != null && !coverBmp.isRecycled()) {
                try {
                    Bitmap tiny = Bitmap.createScaledBitmap(coverBmp, 16, 16, true);
                    Paint bp = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
                    bp.setAlpha(isClear ? 115 : 195);
                    canvas.drawBitmap(tiny, null, rect, bp);
                    tiny.recycle();
                } catch (Throwable ignored) {
                }
            }
            Paint tint = new Paint(Paint.ANTI_ALIAS_FLAG);
            int aTop = isClear ? 82 : 172;
            int aBot = isClear ? 105 : 210;
            int cTop = Color.argb(aTop, Math.max(18, ar / 2), Math.max(18, ag / 2), Math.max(22, ab / 2));
            int cBot = Color.argb(aBot, 12, 14, 20);
            tint.setShader(new LinearGradient(0, 0, 0, h, cTop, cBot, Shader.TileMode.CLAMP));
            canvas.drawRect(rect, tint);

            // Glass diagonal shine (Kilau kaca)
            float shineAlpha = (clamp(cfg.glassShine, 0, 100) / 100f) * (isClear ? 0.36f : 0.24f);
            if (shineAlpha > 0.01f) {
                Paint sp = new Paint(Paint.ANTI_ALIAS_FLAG);
                sp.setShader(new LinearGradient(
                        0, 0, w * 0.85f, h * 0.75f,
                        Color.argb(Math.round(shineAlpha * 255f), 255, 255, 255),
                        Color.argb(0, 255, 255, 255),
                        Shader.TileMode.CLAMP
                ));
                canvas.drawRect(rect, sp);
            }
        }

        canvas.restore();

        // Specular lens rim border (Ketebalan kaca)
        float thickRatio = clamp(cfg.glassThickness, 0, 100) / 100f;
        float strokeW = "light".equals(style) || "dark".equals(style) ? 1.6f : (1.5f + thickRatio * 2.5f);
        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(strokeW);
        if ("light".equals(style)) {
            border.setColor(Color.argb(36, 0, 0, 0));
        } else if ("dark".equals(style)) {
            border.setColor(Color.argb(40, 255, 255, 255));
        } else {
            int topA = Math.round((0.28f + thickRatio * 0.45f) * 255f);
            int botA = Math.round((0.08f + thickRatio * 0.16f) * 255f);
            border.setShader(new LinearGradient(
                    0, 0, 0, h,
                    Color.argb(topA, 255, 255, 255),
                    Color.argb(botA, 255, 255, 255),
                    Shader.TileMode.CLAMP
            ));
        }
        RectF strokeRect = new RectF(strokeW / 2f, strokeW / 2f, w - strokeW / 2f, h - strokeW / 2f);
        canvas.drawRoundRect(strokeRect, Math.max(0f, radius - strokeW / 2f), Math.max(0f, radius - strokeW / 2f), border);
        return out;
    }

    public static Bitmap renderShapedCoverBitmap(Bitmap src, int sizePx, String coverShape) {
        if (src == null || src.isRecycled()) return null;
        int sz = Math.max(32, Math.min(140, sizePx));
        int sw = src.getWidth();
        int sh = src.getHeight();
        int side = Math.min(sw, sh);
        int sx = (sw - side) / 2;
        int sy = (sh - side) / 2;

        Bitmap out = Bitmap.createBitmap(sz, sz, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        RectF dst = new RectF(0, 0, sz, sz);
        float rad = sz * 0.22f;
        if ("circle".equals(coverShape)) rad = sz / 2f;
        else if ("square".equals(coverShape)) rad = sz * 0.04f;

        canvas.drawRoundRect(dst, rad, rad, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        canvas.drawBitmap(src, new Rect(sx, sy, sx + side, sy + side), dst, paint);
        return out;
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
`;
}

function getBaseWidgetProviderJava(APP_ID) {
  return `package ${APP_ID};

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import androidx.media3.common.util.UnstableApi;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public abstract class SpotyFlowBaseWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_WIDGET_CMD = "${APP_ID}.WIDGET_CMD";
    public static final String EXTRA_CMD = "cmd";

    private static final ExecutorService WIDGET_EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile long lastFullUpdateMs = 0L;

    protected abstract String getSizeKey();

    protected int getLayoutResForSize(String sizeKey) {
        if ("1x1".equals(sizeKey)) return R.layout.widget_player_1x1;
        if ("2x2".equals(sizeKey)) return R.layout.widget_player_2x2;
        if ("2x4".equals(sizeKey)) return R.layout.widget_player_2x4;
        if ("4x1".equals(sizeKey)) return R.layout.widget_player_4x1;
        return R.layout.widget_player_4x2;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) return;
        final Context appCtx = context.getApplicationContext();
        final String key = getSizeKey();
        final int[] ids = appWidgetIds.clone();
        WIDGET_EXECUTOR.execute(() -> {
            try {
                RemoteViews views = buildRemoteViewsForSize(appCtx, key);
                appWidgetManager.updateAppWidget(ids, views);
            } catch (Throwable ignored) {
            }
        });
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
                updateAllWidgets(context, true);
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
            if ("like".equals(cmd)) {
                SpotyFlowPlaybackService.lastLiked = !SpotyFlowPlaybackService.lastLiked;
                MainActivity.sendMediaActionToJs("like", 0L);
            } else if ("prev".equals(cmd)) {
                MainActivity.sendMediaActionToJs("prev", 0L);
            } else if ("next".equals(cmd)) {
                MainActivity.sendMediaActionToJs("next", 0L);
            } else if ("play_pause".equals(cmd)) {
                String action = SpotyFlowPlaybackService.isPlaying ? "pause" : "play";
                MainActivity.sendMediaActionToJs(action, 0L);
            }
            updateAllWidgets(context, true);
        }
    }

    public static void updateAllWidgets(final Context context) {
        updateAllWidgets(context, false);
    }

    public static void updateAllWidgets(final Context context, final boolean force) {
        if (context == null) return;
        final long now = SystemClock.elapsedRealtime();
        if (!force && (now - lastFullUpdateMs < 350L)) {
            return;
        }
        lastFullUpdateMs = now;
        final Context appCtx = context.getApplicationContext();
        WIDGET_EXECUTOR.execute(() -> {
            try {
                AppWidgetManager mgr = AppWidgetManager.getInstance(appCtx);
                if (mgr == null) return;
                updateProviderGroup(appCtx, mgr, SpotyFlowPlayer1x1Provider.class, "1x1");
                updateProviderGroup(appCtx, mgr, SpotyFlowPlayer2x2Provider.class, "2x2");
                updateProviderGroup(appCtx, mgr, SpotyFlowPlayer2x4Provider.class, "2x4");
                updateProviderGroup(appCtx, mgr, SpotyFlowPlayer4x1Provider.class, "4x1");
                updateProviderGroup(appCtx, mgr, SpotyFlowPlayer4x2Provider.class, "4x2");
            } catch (Throwable ignored) {
            }
        });
    }

    public static void updateLyricsWidgetsOnly(final Context context) {
        // Lightweight no-op hook preserved for zero Bitmap IPC during lyric updates
    }

    private static void updateProviderGroup(Context ctx, AppWidgetManager mgr, Class<?> cls, String sizeKey) {
        try {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, cls));
            if (ids != null && ids.length > 0) {
                RemoteViews views = buildRemoteViewsForSize(ctx, sizeKey);
                mgr.updateAppWidget(ids, views);
            }
        } catch (Throwable ignored) {
        }
    }

    private static String formatMs(long ms) {
        long sec = Math.max(0L, ms / 1000L);
        long m = sec / 60L;
        long s = sec % 60L;
        return String.format(Locale.US, "%d:%02d", m, s);
    }

    private static RemoteViews buildRemoteViewsForSize(Context ctx, String sizeKey) {
        int layoutId = R.layout.widget_player_4x2;
        int bgW = 420, bgH = 220, covSz = 128;
        if ("1x1".equals(sizeKey)) { layoutId = R.layout.widget_player_1x1; bgW = 160; bgH = 160; covSz = 136; }
        else if ("2x2".equals(sizeKey)) { layoutId = R.layout.widget_player_2x2; bgW = 260; bgH = 260; covSz = 104; }
        else if ("2x4".equals(sizeKey)) { layoutId = R.layout.widget_player_2x4; bgW = 260; bgH = 460; covSz = 140; }
        else if ("4x1".equals(sizeKey)) { layoutId = R.layout.widget_player_4x1; bgW = 420; bgH = 110; covSz = 96; }

        SpotyFlowWidgetRenderer.WidgetConfig cfg = SpotyFlowWidgetRenderer.loadConfig(ctx);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), layoutId);

        Bitmap rawCover = SpotyFlowPlaybackService.lastWidgetArtwork;
        int domColor = SpotyFlowPlaybackService.dominantColorInt;

        // 1. Dynamic Glass/Lens/Corner Background Bitmap (IPC-safe compact size!)
        try {
            Bitmap bgBmp = SpotyFlowWidgetRenderer.renderBackgroundBitmap(bgW, bgH, cfg, rawCover, domColor);
            views.setImageViewBitmap(R.id.widget_bg_image, bgBmp);
        } catch (Throwable ignored) {
        }

        // 2. Shaped Album Cover (<= 140x140)
        if (!cfg.showCover && !"1x1".equals(sizeKey)) {
            views.setViewVisibility(R.id.widget_cover, View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_cover, View.VISIBLE);
            Bitmap shaped = SpotyFlowWidgetRenderer.renderShapedCoverBitmap(rawCover, covSz, cfg.coverShape);
            if (shaped != null) {
                views.setImageViewBitmap(R.id.widget_cover, shaped);
            } else {
                views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher);
            }
        }

        // 3. Play/Pause Button & Style
        views.setImageViewResource(
                R.id.widget_btn_play_pause,
                SpotyFlowPlaybackService.isPlaying ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play
        );
        if ("plain".equals(cfg.playBtnStyle)) {
            views.setInt(R.id.widget_btn_play_pause, "setBackgroundResource", android.R.color.transparent);
        } else {
            views.setInt(R.id.widget_btn_play_pause, "setBackgroundResource", R.drawable.widget_btn_play_bg);
        }

        // 4. Text, Like, Controls, Progress, & Streak (on layouts > 1x1)
        if (!"1x1".equals(sizeKey)) {
            boolean isLight = "light".equals(cfg.style);
            int primaryCol = isLight ? Color.rgb(17, 18, 21) : Color.WHITE;
            int secondaryCol = isLight ? Color.argb(180, 17, 18, 21) : Color.argb(204, 255, 255, 255);

            String title = SpotyFlowPlaybackService.lastWidgetTitle;
            if (title == null || title.isEmpty()) title = "SpotyFlow";
            String artist = SpotyFlowPlaybackService.lastWidgetArtist;
            if (artist == null || artist.isEmpty()) artist = "Ketuk untuk memutar";

            float titleSp = "large".equals(cfg.textSize) ? 16f : ("small".equals(cfg.textSize) ? 12f : 14f);
            float artistSp = "large".equals(cfg.textSize) ? 12.5f : ("small".equals(cfg.textSize) ? 10f : 11.5f);

            views.setTextViewText(R.id.widget_title, title);
            views.setTextColor(R.id.widget_title, primaryCol);
            views.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, titleSp);

            views.setTextViewText(R.id.widget_artist, artist);
            views.setTextColor(R.id.widget_artist, secondaryCol);
            views.setTextViewTextSize(R.id.widget_artist, TypedValue.COMPLEX_UNIT_SP, artistSp);

            views.setViewVisibility(R.id.widget_btn_like, cfg.showLike ? View.VISIBLE : View.GONE);
            views.setImageViewResource(
                    R.id.widget_btn_like,
                    SpotyFlowPlaybackService.lastLiked ? R.drawable.ic_widget_heart_filled : R.drawable.ic_widget_heart_outline
            );
            views.setViewVisibility(R.id.widget_btn_prev, cfg.showPrevNext ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_btn_next, cfg.showPrevNext ? View.VISIBLE : View.GONE);

            views.setOnClickPendingIntent(R.id.widget_btn_like, buildCmdPendingIntent(ctx, "like", 204));
            views.setOnClickPendingIntent(R.id.widget_btn_prev, buildCmdPendingIntent(ctx, "prev", 201));
            views.setOnClickPendingIntent(R.id.widget_btn_next, buildCmdPendingIntent(ctx, "next", 203));

            if (!"4x1".equals(sizeKey)) {
                boolean showRow = cfg.showProgress || cfg.showTime;
                views.setViewVisibility(R.id.widget_progress_row, showRow ? View.VISIBLE : View.GONE);
                views.setViewVisibility(R.id.widget_progress, cfg.showProgress ? View.VISIBLE : View.GONE);
                views.setViewVisibility(R.id.widget_time_cur, cfg.showTime ? View.VISIBLE : View.GONE);
                views.setViewVisibility(R.id.widget_time_dur, cfg.showTime ? View.VISIBLE : View.GONE);

                long dur = Math.max(1000L, SpotyFlowPlaybackService.lastDurationMs);
                long pos = Math.max(0L, Math.min(dur, SpotyFlowPlaybackService.lastPositionMs));
                int pct = (int) Math.min(100L, Math.max(0L, (pos * 100L) / dur));
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
                views.setTextViewText(R.id.widget_time_cur, formatMs(pos));
                views.setTextViewText(R.id.widget_time_dur, formatMs(dur));
                views.setTextColor(R.id.widget_time_cur, secondaryCol);
                views.setTextColor(R.id.widget_time_dur, secondaryCol);
            }

            if ("4x2".equals(sizeKey)) {
                views.setViewVisibility(R.id.widget_streak_badge, cfg.showStreak ? View.VISIBLE : View.GONE);
                int days = Math.max(1, SpotyFlowPlaybackService.lastStreakDays);
                views.setTextViewText(R.id.widget_streak_badge, "\\uD83D\\uDD25 " + days);
            }
        }

        // Open MainActivity on root tap + Play/Pause command
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
                ctx, 200, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, openPi);
        views.setOnClickPendingIntent(R.id.widget_btn_play_pause, buildCmdPendingIntent(ctx, "play_pause", 202));
        return views;
    }

    private static PendingIntent buildCmdPendingIntent(Context ctx, String cmd, int reqCode) {
        Intent i = new Intent(ctx, SpotyFlowPlayer4x2Provider.class);
        i.setAction(ACTION_WIDGET_CMD);
        i.putExtra(EXTRA_CMD, cmd);
        return PendingIntent.getBroadcast(
                ctx, reqCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
`;
}

function getWidgetSubclassJava(APP_ID, className, sizeKey) {
  return `package ${APP_ID};

import androidx.media3.common.util.UnstableApi;

@UnstableApi
public class ${className} extends SpotyFlowBaseWidgetProvider {
    @Override
    protected String getSizeKey() {
        return "${sizeKey}";
    }
}
`;
}

function getIslandOverlayServiceJava(APP_ID) {
  return `package ${APP_ID};

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.media3.common.util.UnstableApi;

import org.json.JSONObject;

@UnstableApi
public class SpotyFlowIslandOverlayService extends Service {
    public static volatile boolean overlayEnabled = false;
    public static volatile int verticalOffsetDp = 12;
    public static volatile int pillWidthDp = 210;
    public static volatile boolean showLyricsInPill = true;

    private static volatile SpotyFlowIslandOverlayService activeSvc = null;
    private WindowManager windowManager;
    private LinearLayout rootPill;
    private TextView compactText;
    private LinearLayout expandedControls;
    private boolean expanded = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable collapseRunnable = () -> setExpandedState(false);

    public static void applyConfig(Context ctx, String jsonStr) {
        if (ctx == null) return;
        try {
            if (jsonStr != null && !jsonStr.isEmpty()) {
                JSONObject o = new JSONObject(jsonStr);
                overlayEnabled = o.optBoolean("enabled", false);
                verticalOffsetDp = Math.max(0, Math.min(120, o.optInt("verticalOffsetDp", 12)));
                pillWidthDp = Math.max(150, Math.min(340, o.optInt("pillWidthDp", 210)));
                showLyricsInPill = o.optBoolean("showLyrics", true);
            }
            if (overlayEnabled && canDrawOverlaySafe(ctx)) {
                ctx.startService(new Intent(ctx, SpotyFlowIslandOverlayService.class));
                syncState(ctx);
            } else {
                ctx.stopService(new Intent(ctx, SpotyFlowIslandOverlayService.class));
            }
        } catch (Throwable ignored) {
        }
    }

    public static boolean canDrawOverlaySafe(Context ctx) {
        if (ctx == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            return Settings.canDrawOverlays(ctx);
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static void syncState(Context ctx) {
        final SpotyFlowIslandOverlayService svc = activeSvc;
        if (svc == null) return;
        svc.mainHandler.post(svc::refreshOverlayContent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!overlayEnabled || !canDrawOverlaySafe(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        activeSvc = this;
        ensureOverlayAttached();
        refreshOverlayContent();
        return START_STICKY;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void ensureOverlayAttached() {
        if (rootPill != null) return;
        if (!canDrawOverlaySafe(this)) return;
        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windowManager == null) return;

            rootPill = new LinearLayout(this);
            rootPill.setOrientation(LinearLayout.VERTICAL);
            rootPill.setGravity(Gravity.CENTER_HORIZONTAL);
            rootPill.setPadding(dp(14), dp(8), dp(14), dp(8));

            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(235, 10, 11, 15));
            bg.setCornerRadius(dp(26));
            bg.setStroke(dp(1), Color.argb(55, 255, 255, 255));
            rootPill.setBackground(bg);

            compactText = new TextView(this);
            compactText.setTextColor(Color.WHITE);
            compactText.setTextSize(12f);
            compactText.setSingleLine(true);
            compactText.setEllipsize(TextUtils.TruncateAt.END);
            compactText.setGravity(Gravity.CENTER);
            compactText.setText("♪ SpotyFlow");
            rootPill.addView(compactText);

            expandedControls = new LinearLayout(this);
            expandedControls.setOrientation(LinearLayout.HORIZONTAL);
            expandedControls.setGravity(Gravity.CENTER);
            expandedControls.setPadding(0, dp(6), 0, 0);
            expandedControls.setVisibility(View.GONE);

            expandedControls.addView(makeActionChip("⏮", () -> MainActivity.sendMediaActionToJs("prev", 0L)));
            expandedControls.addView(makeActionChip("⏯", () -> {
                String act = SpotyFlowPlaybackService.isPlaying ? "pause" : "play";
                SpotyFlowPlaybackService.dispatchNativeControl(getApplicationContext(), act, 0L);
                MainActivity.sendMediaActionToJs(act, 0L);
            }));
            expandedControls.addView(makeActionChip("⏭", () -> MainActivity.sendMediaActionToJs("next", 0L)));
            expandedControls.addView(makeActionChip("↗", () -> {
                try {
                    Intent launch = new Intent(getApplicationContext(), MainActivity.class);
                    launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    startActivity(launch);
                } catch (Throwable ignored) {
                }
            }));
            rootPill.addView(expandedControls);

            rootPill.setOnClickListener(v -> setExpandedState(!expanded));

            int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    dp(pillWidthDp),
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    overlayType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            params.y = dp(verticalOffsetDp);
            windowManager.addView(rootPill, params);
        } catch (Throwable ignored) {
            rootPill = null;
        }
    }

    private TextView makeActionChip(String label, final Runnable action) {
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(14f);
        tv.setPadding(dp(12), dp(4), dp(12), dp(4));
        tv.setOnClickListener(v -> {
            try { action.run(); } catch (Throwable ignored) {}
            scheduleAutoCollapse();
        });
        return tv;
    }

    private void setExpandedState(boolean exp) {
        expanded = exp;
        if (expandedControls != null) {
            expandedControls.setVisibility(exp ? View.VISIBLE : View.GONE);
        }
        mainHandler.removeCallbacks(collapseRunnable);
        if (exp) scheduleAutoCollapse();
    }

    private void scheduleAutoCollapse() {
        mainHandler.removeCallbacks(collapseRunnable);
        mainHandler.postDelayed(collapseRunnable, 4000L);
    }

    private void refreshOverlayContent() {
        if (compactText == null) return;
        String lyric = showLyricsInPill ? SpotyFlowPlaybackService.currentLyricLine : "";
        String title = SpotyFlowPlaybackService.lastWidgetTitle;
        if (lyric != null && !lyric.isEmpty()) {
            compactText.setText("♪ " + lyric);
        } else if (title != null && !title.isEmpty()) {
            compactText.setText("♪ " + title);
        } else {
            compactText.setText("♪ SpotyFlow");
        }
    }

    @Override
    public void onDestroy() {
        activeSvc = null;
        mainHandler.removeCallbacks(collapseRunnable);
        try {
            if (windowManager != null && rootPill != null) {
                windowManager.removeView(rootPill);
            }
        } catch (Throwable ignored) {
        }
        rootPill = null;
        super.onDestroy();
    }
}
`;
}

module.exports = {
  IC_WIDGET_HEART_OUTLINE_XML,
  IC_WIDGET_HEART_FILLED_XML,
  WIDGET_PROGRESS_DRAWABLE_XML,
  WIDGET_PLAYER_1X1_XML,
  WIDGET_PLAYER_2X2_XML,
  WIDGET_PLAYER_2X4_XML,
  WIDGET_PLAYER_4X1_XML,
  WIDGET_PLAYER_4X2_XML,
  WIDGET_INFOS,
  getWidgetRendererJava,
  getBaseWidgetProviderJava,
  getWidgetSubclassJava,
  getIslandOverlayServiceJava,
};
