package com.phuketai.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

/**
 * PhuketAI Android shell.
 * The whole UI lives in assets/www (a single-page app) and talks to the
 * gateway through {@link Bridge}, which sidesteps WebView CORS limits.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<String, HttpURLConnection>();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long lastBackPress = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        w.setStatusBarColor(Color.parseColor("#0E1113"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            w.setNavigationBarColor(Color.parseColor("#0E1113"));
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0E1113"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (scheme.equals("file")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Work out how much (if any) the window already insets the WebView.
                // With targetSdk 34 the system normally places the view below the
                // status bar, so no extra CSS padding is needed.
                try {
                    int[] loc = new int[2];
                    view.getLocationOnScreen(loc);
                    float d = getResources().getDisplayMetrics().density;
                    int statusBar = 0;
                    int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
                    if (id > 0) statusBar = getResources().getDimensionPixelSize(id);
                    float cssTop = loc[1] > 0 ? 0f : statusBar / (d == 0 ? 1 : d);
                    view.evaluateJavascript("window.__applyInsets && window.__applyInsets("
                            + cssTop + ",0)", null);
                } catch (Exception ignored) {}
            }
        });

        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Native");
        web.loadUrl(START_URL);

        setContentView(web);
    }

    private String jsStr(String s) {
        if (s == null) return "null";
        return JSONObject.quote(s);
    }

    private void callJs(final String js) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (web != null) {
                    try { web.evaluateJavascript(js, null); } catch (Exception ignored) {}
                }
            }
        });
    }

    private static String b64(String s) {
        return Base64.encodeToString(s.getBytes(java.nio.charset.Charset.forName("UTF-8")), Base64.NO_WRAP);
    }

    private HttpURLConnection openConn(String method, String url, String headersJson, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000);
        c.setReadTimeout(120000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Accept-Encoding", "gzip");
        c.setRequestProperty("User-Agent", "PhuketAI-Android/1.0");
        if (headersJson != null && headersJson.length() > 2) {
            JSONObject h = new JSONObject(headersJson);
            Iterator<String> it = h.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = h.optString(k, null);
                if (v != null) c.setRequestProperty(k, v);
            }
        }
        if (body != null && body.length() > 0 && !"GET".equals(method) && !"DELETE".equals(method)) {
            c.setDoOutput(true);
            byte[] bytes = body.getBytes("UTF-8");
            c.setFixedLengthStreamingMode(bytes.length);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.flush();
            os.close();
        }
        return c;
    }

    private static String readAll(InputStream raw) throws Exception {
        if (raw == null) return "";
        InputStream in = new BufferedInputStream(raw);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private static String readBody(HttpURLConnection c) throws Exception {
        int code = c.getResponseCode();
        String enc = c.getContentEncoding();
        InputStream raw = code >= 400 ? c.getErrorStream() : c.getInputStream();
        if (raw != null && enc != null && enc.toLowerCase().contains("gzip")) {
            raw = new GZIPInputStream(new BufferedInputStream(raw));
        }
        return readAll(raw);
    }

    private static String headersJson(HttpURLConnection c) {
        JSONObject o = new JSONObject();
        try {
            for (Map.Entry<String, java.util.List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                try { o.put(e.getKey().toLowerCase(), e.getValue().get(0)); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return o.toString();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000) {
            super.onBackPressed();
        } else {
            lastBackPress = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        for (HttpURLConnection c : active.values()) {
            try { c.disconnect(); } catch (Exception ignored) {}
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** JS <-> native bridge. Every method runs on the WebView's JS thread. */
    public class Bridge {

        @JavascriptInterface
        public void http(final String id, final String method, final String url,
                         final String headers, final String body) {
            pool.execute(new Runnable() {
                @Override public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = openConn(method, url, headers, body);
                        String text = readBody(c);
                        int status = c.getResponseCode();
                        String h = headersJson(c);
                        callJs("window.__nativeHttp(" + jsStr(id) + "," + status + ","
                                + jsStr(b64(text)) + "," + jsStr(h) + ")");
                    } catch (Exception e) {
                        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                        callJs("window.__nativeHttp(" + jsStr(id) + ",0," + jsStr(b64("")) + ","
                                + jsStr("{\"error\":" + JSONObject.quote(msg) + "}") + ")");
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void stream(final String id, final String method, final String url,
                           final String headers, final String body) {
            pool.execute(new Runnable() {
                @Override public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = openConn(method, url, headers, body);
                        active.put(id, c);
                        c.setReadTimeout(300000);
                        int status = c.getResponseCode();
                        if (status >= 400) {
                            String err = readAll(c.getErrorStream());
                            callJs("window.__nativeEnd(" + jsStr(id) + "," + jsStr(err) + ","
                                    + status + ")");
                            return;
                        }
                        String enc = c.getContentEncoding();
                        InputStream raw = c.getInputStream();
                        if (enc != null && enc.toLowerCase().contains("gzip")) {
                            raw = new GZIPInputStream(new BufferedInputStream(raw));
                        }
                        BufferedReader br = new BufferedReader(new InputStreamReader(raw, "UTF-8"), 8192);
                        String line;
                        while ((line = br.readLine()) != null) {
                            if (!active.containsKey(id)) break;
                            callJs("window.__nativeChunk(" + jsStr(id) + "," + jsStr(b64(line)) + ")");
                        }
                        callJs("window.__nativeEnd(" + jsStr(id) + ",null," + status + ")");
                    } catch (Exception e) {
                        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                        callJs("window.__nativeEnd(" + jsStr(id) + "," + jsStr(msg) + ",0)");
                    } finally {
                        active.remove(id);
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void abort(final String id) {
            HttpURLConnection c = active.remove(id);
            if (c != null) {
                try { c.disconnect(); } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public void toast(final String msg) {
            ui.post(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            ui.post(new Runnable() {
                @Override public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("PhuketAI", text));
                }
            });
        }

        @JavascriptInterface
        public void open(final String url) {
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "无法打开链接", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void openInApp(final String url) {
            ui.post(new Runnable() {
                @Override public void run() {
                    if (web != null && url != null && (url.startsWith("https://") || url.startsWith("http://"))) {
                        web.loadUrl(url);
                    }
                }
            });
        }

        @JavascriptInterface
        public void vibrate(final int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null) v.vibrate(ms);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String device() {
            JSONObject o = new JSONObject();
            try {
                o.put("model", Build.MODEL);
                o.put("brand", Build.BRAND);
                o.put("release", Build.VERSION.RELEASE);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("app", "1.0.0");
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void statusBar(final String color, final boolean darkIcons) {
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        Window w = getWindow();
                        w.setStatusBarColor(Color.parseColor(color));
                        w.setNavigationBarColor(Color.parseColor(color));
                        View dv = w.getDecorView();
                        int flags = dv.getSystemUiVisibility();
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            if (darkIcons) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            dv.setSystemUiVisibility(flags);
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            ui.post(new Runnable() {
                @Override public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }
}
