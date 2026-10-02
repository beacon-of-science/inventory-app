package com.inventory.localapp;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** User-selected SAF documents only. No storage permission or persistent URI grants. */
@CapacitorPlugin(name = "InventoryFiles")
public class InventoryFilesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PluginCall pending;
    private Closeable activeStream;
    private boolean destroyed;

    private synchronized boolean begin(PluginCall call) {
        if (destroyed) { call.reject("文件操作已中断，请重新打开应用", "FILE_INTERRUPTED"); return false; }
        if (pending != null) { call.reject("文件操作正在进行，请先完成或取消当前操作", "FILE_BUSY"); return false; }
        pending = call;
        return true;
    }

    @PluginMethod
    public void exportFile(PluginCall call) {
        if (!begin(call)) return;
        try {
            InventoryFileCodec.encode(call.getString("content"));
            String name = call.getString("fileName", "inventory-backup.json");
            name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (name.length() > 100) name = name.substring(0, 100);
            if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".json")) name += ".json";
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, name);
            launch(call, intent, "exportResult");
        } catch (Exception error) { reject(call, message(error, "无法准备导出文件，请重试")); }
    }

    @PluginMethod
    public void importFile(PluginCall call) {
        if (!begin(call)) return;
        // Providers sometimes label .json as text/plain or octet-stream. Content is validated later.
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/json", "text/plain", "application/octet-stream"});
        launch(call, intent, "importResult");
    }

    private void launch(PluginCall call, Intent intent, String callback) {
        if (getActivity() == null || getActivity().isFinishing() || getActivity().isDestroyed()) {
            reject(call, "文件操作已中断，请重新打开应用"); return;
        }
        getActivity().runOnUiThread(() -> {
            synchronized (this) { if (destroyed || pending != call) return; }
            try { startActivityForResult(call, intent, callback); }
            catch (Exception error) { reject(call, "无法打开系统文件选择器，请确认设备支持文件管理"); }
        });
    }

    private Uri selectedUri(PluginCall call, ActivityResult result) {
        if (call == null) {
            synchronized (this) { pending = null; }
            return null;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject data = new JSObject(); data.put("cancelled", true); resolve(call, data); return null;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null || !"content".equals(uri.getScheme())) {
            reject(call, "未获得有效文件，请重新选择"); return null;
        }
        return uri;
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult result) {
        Uri uri = selectedUri(call, result);
        if (uri == null) return;
        execute(call, () -> {
            byte[] data = InventoryFileCodec.encode(call.getString("content"));
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (stream == null) throw new IOException("无法写入所选文件");
                track(call, stream);
                stream.write(data);
                stream.flush();
            } finally { untrack(); }
            JSObject value = new JSObject(); value.put("cancelled", false); resolve(call, value);
        }, "保存文件失败，请检查可用空间和文件访问权限");
    }

    @ActivityCallback
    private void importResult(PluginCall call, ActivityResult result) {
        Uri uri = selectedUri(call, result);
        if (uri == null) return;
        execute(call, () -> {
            String name = "inventory-backup.json";
            try (Cursor cursor = getContext().getContentResolver().query(uri,
                    new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex) && cursor.getLong(sizeIndex) > InventoryFileCodec.MAX_BYTES)
                        throw new IOException("文件不能超过 5 MiB");
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex);
                }
            }
            String content;
            try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                if (stream == null) throw new IOException("无法读取所选文件");
                track(call, stream);
                content = InventoryFileCodec.read(stream);
            } finally { untrack(); }
            JSObject value = new JSObject(); value.put("cancelled", false); value.put("content", content); value.put("fileName", name);
            resolve(call, value);
        }, "读取文件失败，请重新选择可访问的 JSON 文件");
    }

    private interface FileAction { void run() throws Exception; }
    private void execute(PluginCall call, FileAction action, String fallback) {
        try {
            io.execute(() -> {
                synchronized (this) { if (destroyed || pending != call) return; }
                try { action.run(); } catch (Exception error) { reject(call, message(error, fallback)); }
            });
        } catch (Exception error) { reject(call, "文件操作已中断，请重试"); }
    }

    private static String message(Exception error, String fallback) {
        String message = error.getMessage();
        return message != null && message.matches(".*[\\u4e00-\\u9fff].*") ? message : fallback;
    }

    private synchronized void track(PluginCall call, Closeable stream) throws IOException {
        if (destroyed || pending != call) { stream.close(); throw new IOException("文件操作已中断，请重试"); }
        activeStream = stream;
    }
    private synchronized void untrack() { activeStream = null; }
    private synchronized void resolve(PluginCall call, JSObject result) {
        if (destroyed || pending != call) return;
        pending = null; call.resolve(result);
    }
    private synchronized void reject(PluginCall call, String message) {
        if (pending != call) return;
        pending = null; call.reject(message, "FILE_FAILED");
    }

    @Override
    protected synchronized void handleOnDestroy() {
        destroyed = true;
        if (pending != null) reject(pending, "文件操作已中断，请重新打开应用");
        if (activeStream != null) { try { activeStream.close(); } catch (IOException ignored) {} activeStream = null; }
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
