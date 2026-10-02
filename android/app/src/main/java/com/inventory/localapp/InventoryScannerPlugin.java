package com.inventory.localapp;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "InventoryScanner", permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
})
public class InventoryScannerPlugin extends Plugin {
    private final AtomicBoolean scanning = new AtomicBoolean(false);
    private PluginCall pendingCall;

    @PluginMethod
    public void scanInventoryBatch(PluginCall call) {
        String mode = call.getString("mode", "");
        String barcode = call.getString("barcode", "");
        String format = call.getString("format");
        if (!(mode.equals("single") || mode.equals("multiple") || mode.equals("unique")) || !(InventoryBatchSession.validCode(barcode, 80) || (mode.equals("unique") && barcode.isEmpty())) || (format != null && !BarcodeFormats.supports(format))) {
            call.reject("扫码参数无效", "INVALID_INPUT"); return;
        }
        scan(call);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (!scanning.compareAndSet(false, true)) {
            call.reject("扫码正在进行，请先完成或取消当前扫码", "SCAN_BUSY");
            return;
        }
        pendingCall = call;
        if (!CameraOperationGate.acquire(this)) { fail(call, "相机正在用于扫码或包装识别，请先完成或取消", "SCAN_BUSY"); return; }
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            fail(call, "此设备没有可用摄像头，请手动输入商品条码", "NO_CAMERA");
            return;
        }
        try {
            if (getPermissionState("camera") != PermissionState.GRANTED) {
                requestPermissionForAlias("camera", call, "cameraPermissionResult");
            } else {
                launchScanner(call);
            }
        } catch (Exception exception) {
            fail(call, "无法启动扫码，请重试或手动输入商品条码", "SCAN_FAILED");
        }
    }

    @PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        if (call == null) {
            CameraOperationGate.release(this);
            scanning.set(false);
            pendingCall = null;
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            fail(call, "未获得相机权限。请在系统设置中允许相机权限，或手动输入商品条码", "CAMERA_DENIED");
            return;
        }
        launchScanner(call);
    }

    private void launchScanner(PluginCall call) {
        if (getActivity() == null || getActivity().isFinishing() || getActivity().isDestroyed()) {
            fail(call, "扫码已中断，请重新打开扫码", "SCAN_INTERRUPTED");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (pendingCall != call || !scanning.get()) return;
                boolean batch = call.getMethodName().equals("scanInventoryBatch");
                Intent intent = new Intent(getContext(), batch ? InventoryBatchScannerActivity.class : BarcodeScannerActivity.class);
                if (batch) intent.putExtra("mode", call.getString("mode")).putExtra("barcode", call.getString("barcode")).putExtra("format", call.getString("format"));
                startActivityForResult(call, intent, "scanResult");
            } catch (Exception exception) {
                fail(call, "无法打开扫码页面，请重试或手动输入商品条码", "SCAN_FAILED");
            }
        });
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult activityResult) {
        CameraOperationGate.release(this);
        scanning.set(false);
        pendingCall = null;
        if (call == null) return;
        Intent data = activityResult.getData();
        if (data != null && data.hasExtra("error")) {
            call.reject(data.getStringExtra("error"), data.getStringExtra("code"));
            return;
        }
        JSObject result = new JSObject();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null) {
            result.put("cancelled", true);
        } else {
            if (call.getMethodName().equals("scanInventoryBatch")) {
                java.util.ArrayList<String> codes = data.getStringArrayListExtra("codes");
                String mode = call.getString("mode", "");
                if (codes == null || codes.isEmpty() || codes.size() > 10000 || codes.stream().anyMatch(value -> !InventoryBatchSession.validCode(value, mode.equals("unique") ? 120 : 80) || (!mode.equals("unique") && !value.equals(call.getString("barcode")))) || (mode.equals("unique") && new java.util.HashSet<>(codes).size() != codes.size())) {
                    call.reject("识别结果无效，请重新扫码", "INVALID_RESULT"); return;
                }
                result.put("cancelled", false);
                result.put("codes", new JSArray(codes));
                result.put("quantity", codes.size());
                call.resolve(result); return;
            }
            String barcode = data.getStringExtra("barcode");
            String format = data.getStringExtra("format");
            if (barcode == null || barcode.isEmpty() || !BarcodeFormats.supports(format)) {
                call.reject("识别结果无效，请重新扫描商品一维条码", "INVALID_RESULT");
                return;
            }
            result.put("cancelled", false);
            result.put("barcode", barcode);
            result.put("format", format);
        }
        call.resolve(result);
    }

    private void fail(PluginCall call, String message, String code) {
        CameraOperationGate.release(this);
        scanning.set(false);
        pendingCall = null;
        call.reject(message, code);
    }

    @Override
    protected void handleOnDestroy() {
        CameraOperationGate.release(this);
        if (pendingCall != null) {
            fail(pendingCall, "扫码已中断，请重新打开扫码", "SCAN_INTERRUPTED");
        }
        scanning.set(false);
        super.handleOnDestroy();
    }
}
