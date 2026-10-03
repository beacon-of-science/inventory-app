package com.inventory.localapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.CameraPreview;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.camera.CameraSettings;
import java.util.List;

/** One successful decode finishes the activity; this screen never changes inventory. */
public class BarcodeScannerActivity extends AppCompatActivity {
    private DecoratedBarcodeView scanner;
    private boolean completed;
    private boolean active;
    private long generation;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> fail("未识别到商品条码，请调整距离和光线后重试，或手动输入", "SCAN_TIMEOUT");

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(16, 36, 48));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });
        TextView title = new TextView(this);
        title.setText("扫描商品条码");
        title.setTextSize(22);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        title.setPadding(20, 24, 20, 16);
        root.addView(title);
        scanner = new DecoratedBarcodeView(this);
        scanner.setStatusText("将包装上的一维条码对准取景框\n识别后返回商品页面，不会自动出入库");
        scanner.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(BarcodeFormats.SUPPORTED));
        scanner.getBarcodeView().addStateListener(new CameraPreview.StateListener() {
            public void previewSized() {}
            public void previewStarted() {}
            public void previewStopped() {}
            public void cameraClosed() {}
            public void cameraError(Exception error) {
                fail("无法打开摄像头，请检查相机权限或关闭其他占用相机的应用", "CAMERA_UNAVAILABLE");
            }
        });
        try {
            CameraSettings settings = new CameraSettings();
            settings.setRequestedCameraId(selectCamera());
            scanner.setCameraSettings(settings);
        } catch (Exception error) {
            fail("此设备没有可用摄像头，请手动输入商品条码", "NO_CAMERA");
            return;
        }
        root.addView(scanner, new LinearLayout.LayoutParams(-1, 0, 1));
        Button cancel = new Button(this);
        cancel.setText("取消扫码");
        cancel.setOnClickListener(view -> cancelScan());
        LinearLayout.LayoutParams buttonLayout = new LinearLayout.LayoutParams(-1, -2);
        buttonLayout.setMargins(24, 16, 24, 24);
        root.addView(cancel, buttonLayout);
        setContentView(root);
        ViewCompat.requestApplyInsets(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { cancelScan(); }
        });
    }

    @SuppressWarnings("deprecation")
    private int selectCamera() {
        int count = Camera.getNumberOfCameras();
        if (count == 0) throw new IllegalStateException("No camera");
        Camera.CameraInfo info = new Camera.CameraInfo();
        for (int index = 0; index < count; index++) {
            Camera.getCameraInfo(index, info);
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) return index;
        }
        return 0;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (completed || scanner == null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            fail("相机权限已关闭，请允许相机权限后重试", "CAMERA_DENIED");
            return;
        }
        try {
            active = true;
            long token = ++generation;
            scanner.decodeSingle(new BarcodeCallback() {
                @Override public void barcodeResult(BarcodeResult result) {
                    if (!active || generation != token || completed || result == null || !BarcodeFormats.SUPPORTED.contains(result.getBarcodeFormat())) return;
                    completed = true;
                    handler.removeCallbacks(timeout);
                    scanner.pause();
                    setResult(RESULT_OK, new Intent().putExtra("barcode", result.getText()).putExtra("format", result.getBarcodeFormat().name()));
                    finish();
                }
                @Override public void possibleResultPoints(List<ResultPoint> points) {}
            });
            scanner.resume();
            handler.postDelayed(timeout, 60000);
        } catch (Exception error) {
            fail("摄像头启动失败，请重试或手动输入商品条码", "CAMERA_UNAVAILABLE");
        }
    }

    @Override
    protected void onPause() {
        active = false;
        generation++;
        handler.removeCallbacks(timeout);
        if (scanner != null) scanner.pause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        active = false;
        completed = true;
        generation++;
        handler.removeCallbacksAndMessages(null);
        if (scanner != null) scanner.pause();
        super.onDestroy();
    }

    private void cancelScan() {
        if (completed) return;
        completed = true;
        setResult(RESULT_CANCELED);
        finish();
    }

    private void fail(String message, String code) {
        if (completed) return;
        completed = true;
        handler.removeCallbacks(timeout);
        setResult(RESULT_CANCELED, new Intent().putExtra("error", message).putExtra("code", code));
        finish();
    }
}
