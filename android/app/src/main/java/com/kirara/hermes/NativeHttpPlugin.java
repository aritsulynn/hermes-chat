package com.kirara.hermes;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Raw HTTP pipe that bypasses the WebView's cookie and CORS rules.
 *
 * <p>The app (http://localhost) talks to a user-supplied gateway on another
 * origin (http://192.168.x.x:9119) whose session cookie is
 * {@code SameSite=lax}. The WebView will never attach that cookie to a
 * cross-origin fetch — no flag changes that, it is the cookie's own
 * contract. So the JS layer keeps its own jar (see
 * services/dashboard.ts {@code mergeCookies}) and this plugin is a dumb pipe:
 * it sends exactly the headers it is given (including our explicit
 * {@code Cookie} header) and hands back every response header, including each
 * {@code Set-Cookie}, for JS to jar. SameSite is never consulted because no
 * browser network stack is involved.
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {

  private static final ExecutorService pool = Executors.newCachedThreadPool();

  @PluginMethod
  public void request(PluginCall call) {
    String url = call.getString("url");
    if (url == null || url.isEmpty()) {
      call.reject("NativeHttp: missing url");
      return;
    }
    String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
    JSObject headers = call.getObject("headers", new JSObject());
    String body = call.getString("body", null);
    int timeoutMs = call.getInt("timeoutMs", 15000);

    pool.execute(() -> {
      HttpURLConnection conn = null;
      try {
        conn = (HttpURLConnection) new URL(url).openConnection();
        // Mirror fetch's `redirect: 'manual'` — callers decide what a 3xx means.
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setRequestMethod(method);
        java.util.Iterator<String> names = headers.keys();
        while (names.hasNext()) {
          String name = names.next();
          String value = headers.optString(name, null);
          if (value != null) {
            conn.setRequestProperty(name, value);
          }
        }
        if (body != null && !body.isEmpty() && !method.equals("GET") && !method.equals("HEAD")) {
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          conn.setDoOutput(true);
          conn.setFixedLengthStreamingMode(bytes.length);
          try (OutputStream out = conn.getOutputStream()) {
            out.write(bytes);
          }
        }
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = "";
        if (in != null) {
          try (InputStream auto = in;
              ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = auto.read(chunk)) != -1) {
              buf.write(chunk, 0, n);
            }
            text = buf.toString(StandardCharsets.UTF_8.name());
          }
        }
        JSObject out = new JSObject();
        out.put("status", status);
        JSObject hs = new JSObject();
        Map<String, List<String>> fields = conn.getHeaderFields();
        if (fields != null) {
          for (Map.Entry<String, List<String>> e : fields.entrySet()) {
            if (e.getKey() == null) {
              continue; // status line
            }
            JSArray arr = new JSArray();
            for (String v : e.getValue()) {
              arr.put(v);
            }
            hs.put(e.getKey(), arr);
          }
        }
        out.put("headers", hs);
        out.put("body", text);
        call.resolve(out);
      } catch (java.net.SocketTimeoutException ste) {
        call.reject("Request timed out: " + url);
      } catch (Exception ex) {
        String detail = ex.getMessage() != null ? ex.getMessage() : "request failed";
        call.reject(ex.getClass().getSimpleName() + ": " + detail);
      } finally {
        if (conn != null) {
          conn.disconnect();
        }
      }
    });
  }
}
