package com.inventory.localapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.*;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.util.*;
import java.util.concurrent.*;

/** Local camera analysis only. No frame is stored or transmitted. */
public class InventoryBatchScannerActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private BarcodeScanner detector;
    private ProcessCameraProvider provider;
    private PreviewView preview;
    private android.view.View overlay;
    private final ArrayList<Rect> marked = new ArrayList<>();
    private int imageWidth=1,imageHeight=1;
    private TextView status;
    private Button confirm, done;
    private InventoryBatchSession session;
    private String expectedFormat;
    private volatile boolean active, completed;
    private volatile long generation;
    private long frameAt;
    private ArrayList<String> frameCodes = new ArrayList<>();
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable stale = new Runnable() { public void run() { if (!active) return; if (android.os.SystemClock.elapsedRealtime()-frameAt>1000) { clearFrame(); render(); } handler.postDelayed(this,300); } };
    private void clearFrame(){frameCodes.clear();marked.clear();if(overlay!=null)overlay.invalidate();}

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        session = new InventoryBatchSession(getIntent().getStringExtra("mode"),getIntent().getStringExtra("barcode"));
        expectedFormat=getIntent().getStringExtra("format");
        if (state!=null) { ArrayList<String> saved=state.getStringArrayList("confirmed"); if(saved!=null) session.restore(saved); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        detector=BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(
            Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E,
            Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93, Barcode.FORMAT_ITF,
            Barcode.FORMAT_CODABAR, Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX, Barcode.FORMAT_PDF417, Barcode.FORMAT_AZTEC).build());
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(0xff102430);
        ViewCompat.setOnApplyWindowInsetsListener(root,(v,insets)-> { Insets i=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()); v.setPadding(i.left,i.top,i.right,i.bottom); return insets; });
        status=new TextView(this); status.setTextColor(-1); status.setTextSize(17); status.setPadding(18,14,18,14); status.setGravity(Gravity.CENTER); root.addView(status);
        preview=new PreviewView(this); preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        FrameLayout cameraFrame=new FrameLayout(this); cameraFrame.addView(preview,new FrameLayout.LayoutParams(-1,-1));
        overlay=new android.view.View(this) { @Override protected void onDraw(android.graphics.Canvas canvas) {
            super.onDraw(canvas); android.graphics.Paint paint=new android.graphics.Paint(); paint.setColor(0xff36ef9c); paint.setStyle(android.graphics.Paint.Style.STROKE); paint.setStrokeWidth(5);
            float scale=Math.min((float)getWidth()/imageWidth,(float)getHeight()/imageHeight); float dx=(getWidth()-imageWidth*scale)/2,dy=(getHeight()-imageHeight*scale)/2;
            for(Rect box:marked)canvas.drawRect(dx+box.left*scale,dy+box.top*scale,dx+box.right*scale,dy+box.bottom*scale,paint);
        }}; cameraFrame.addView(overlay,new FrameLayout.LayoutParams(-1,-1)); root.addView(cameraFrame,new LinearLayout.LayoutParams(-1,0,1));
        confirm=new Button(this); confirm.setOnClickListener(v->confirmFrame()); root.addView(confirm);
        if(session.mode.equals("unique")) {
            EditText input=new EditText(this); input.setSingleLine(); input.setHint("手动输入单件码（最多120字符）"); root.addView(input);
            Button add=new Button(this); add.setText("添加手动单件码"); add.setOnClickListener(v->{ String value=input.getText().toString(); if(!InventoryBatchSession.validCode(value,120)) Toast.makeText(this,"请输入1至120位ASCII单件码",Toast.LENGTH_SHORT).show(); else { session.observeUnique(value); input.setText(""); render(); } }); root.addView(add);
        }
        done=new Button(this); done.setText("完成，返回待提交"); done.setOnClickListener(v->finishCodes(new ArrayList<>(session.codes()))); root.addView(done);
        Button cancel=new Button(this); cancel.setText("取消本批扫码"); cancel.setOnClickListener(v->finish()); root.addView(cancel);
        setContentView(root); ViewCompat.requestApplyInsets(root);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){ public void handleOnBackPressed(){finish();} }); render();
    }
    private void render() {
        int count=session.codes().size();
        if(session.mode.equals("unique")) { status.setText("单件码扫描：本批已去重 "+count+" 件\n连续识别，完成后仍需在商品页提交"); confirm.setVisibility(android.view.View.GONE); done.setEnabled(count>0); }
        else if(session.mode.equals("multiple")) { status.setText("同画面多码：当前识别 "+frameCodes.size()+" 个匹配商品\n绿框为计入实体，请核对数量；只确认当前画面"); confirm.setText("确认当前画面 "+frameCodes.size()+" 件并返回"); confirm.setEnabled(!frameCodes.isEmpty()); done.setVisibility(android.view.View.GONE); }
        else { status.setText("逐件扫码：已确认 "+count+" 件\n每件请手动确认一次，画面停留不会自动增加"); confirm.setText("确认这件 +1"); confirm.setEnabled(!frameCodes.isEmpty() && count<10000); done.setEnabled(count>0); }
    }
    private void confirmFrame() {
        if(!active || frameCodes.isEmpty() || android.os.SystemClock.elapsedRealtime()-frameAt>1000) return;
        if(session.mode.equals("multiple")) finishCodes(new ArrayList<>(frameCodes));
        else { session.confirmSingle(); clearFrame(); render(); }
    }
    private void finishCodes(ArrayList<String> codes) { if(completed || codes.isEmpty())return; completed=true; setResult(RESULT_OK,new Intent().putStringArrayListExtra("codes",codes)); finish(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putStringArrayList("confirmed",new ArrayList<>(session.codes())); super.onSaveInstanceState(out); }
    @Override protected void onResume() {
        super.onResume(); if(completed)return;
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){fail("相机权限已关闭，请允许后重试","CAMERA_DENIED");return;}
        active=true; generation++; clearFrame(); render(); handler.post(stale);
        long token=generation;
        ListenableFuture<ProcessCameraProvider> future=ProcessCameraProvider.getInstance(this);
        future.addListener(()-> { if(!active || completed || generation!=token)return; try {
            provider=future.get(); provider.unbindAll();
            Preview p=new Preview.Builder().build(); p.setSurfaceProvider(preview.getSurfaceProvider());
            ImageAnalysis analysis=new ImageAnalysis.Builder().setTargetResolution(new android.util.Size(1920,1080)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
            analysis.setAnalyzer(executor,proxy->analyze(proxy,token));
            CameraSelector selector=provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)?CameraSelector.DEFAULT_BACK_CAMERA:CameraSelector.DEFAULT_FRONT_CAMERA;
            provider.bindToLifecycle(this,selector,p,analysis);
        } catch(Exception e) {fail("无法启动相机，请重试或手动输入","CAMERA_UNAVAILABLE");}},ContextCompat.getMainExecutor(this));
    }
    @androidx.camera.core.ExperimentalGetImage
    private void analyze(ImageProxy proxy,long token) {
        if(!active || completed || generation!=token || proxy.getImage()==null){proxy.close();return;}
        try {
            int rotation=proxy.getImageInfo().getRotationDegrees();
            final int width=(rotation==90||rotation==270)?proxy.getHeight():proxy.getWidth();
            final int height=(rotation==90||rotation==270)?proxy.getWidth():proxy.getHeight();
            detector.process(InputImage.fromMediaImage(proxy.getImage(),proxy.getImageInfo().getRotationDegrees()))
                .addOnSuccessListener(results->{ if(!active || completed || generation!=token)return;
                    ArrayList<String> found=new ArrayList<>(); InventoryBatchFrame frame=new InventoryBatchFrame(); marked.clear(); imageWidth=width;imageHeight=height;
                    for(Barcode b:results) {
                        String value=b.getRawValue(); if(!InventoryBatchSession.validCode(value,session.mode.equals("unique")?120:80))continue;
                        if(session.mode.equals("unique")){session.observeScannedUnique(value,formatName(b.getFormat()));continue;}
                        if(!ordinary(b.getFormat()) || !session.matchesOrdinary(value,formatName(b.getFormat()),expectedFormat))continue;
                        Rect box=b.getBoundingBox(); if(box==null || box.isEmpty())continue;
                        if(frame.add(box.left,box.top,box.right,box.bottom)) { found.add(session.barcode); marked.add(new Rect(box)); }
                    }
                    frameCodes=found; frameAt=android.os.SystemClock.elapsedRealtime(); overlay.invalidate(); render();
                }).addOnFailureListener(e->{if(active && generation==token){clearFrame();render();}}).addOnCompleteListener(task->proxy.close());
        } catch(Exception e){proxy.close();}
    }
    private static boolean ordinary(int f){return formatName(f)!=null;}
    private static String formatName(int f){switch(f){case Barcode.FORMAT_EAN_13:return "EAN_13";case Barcode.FORMAT_EAN_8:return "EAN_8";case Barcode.FORMAT_UPC_A:return "UPC_A";case Barcode.FORMAT_UPC_E:return "UPC_E";case Barcode.FORMAT_CODE_128:return "CODE_128";case Barcode.FORMAT_CODE_39:return "CODE_39";case Barcode.FORMAT_CODE_93:return "CODE_93";case Barcode.FORMAT_ITF:return "ITF";case Barcode.FORMAT_CODABAR:return "CODABAR";default:return null;}}
    private void fail(String message,String code){if(completed)return;completed=true;setResult(RESULT_CANCELED,new Intent().putExtra("error",message).putExtra("code",code));finish();}
    @Override protected void onPause(){active=false;generation++;handler.removeCallbacks(stale);clearFrame();if(provider!=null)provider.unbindAll();super.onPause();}
    @Override protected void onDestroy(){active=false;completed=true;handler.removeCallbacksAndMessages(null);if(provider!=null)provider.unbindAll();if(detector!=null)detector.close();executor.shutdown();super.onDestroy();}
}
