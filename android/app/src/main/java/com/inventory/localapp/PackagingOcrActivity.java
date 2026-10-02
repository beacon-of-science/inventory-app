package com.inventory.localapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
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
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

/** One explicit capture, one text result. No image file, gallery, or network request. */
public class PackagingOcrActivity extends AppCompatActivity {
    private PreviewView preview;
    private ImageCapture cameraCapture;
    private ProcessCameraProvider provider;
    private TextRecognizer recognizer;
    private Button capture,use;
    private TextView status,original;
    private String capturedText="";
    private boolean active,completed,processing;
    private long generation;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);setResult(RESULT_CANCELED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        recognizer=TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        if(saved!=null)capturedText=PackagingOcrText.limit(saved.getString("text",""));
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xff102430);
        ViewCompat.setOnApplyWindowInsetsListener(root,(v,insets)->{Insets i=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);return insets;});
        TextView title=new TextView(this);title.setText("保持同一盒，拍清药名/规格/厂家；可翻面\n每次只识别点击拍摄的这一面，不会自动拼接");title.setTextColor(-1);title.setTextSize(18);title.setPadding(18,16,18,10);root.addView(title);
        preview=new PreviewView(this);root.addView(preview,new LinearLayout.LayoutParams(-1,0,1));
        status=new TextView(this);status.setTextColor(-1);status.setPadding(18,8,18,8);root.addView(status);
        ScrollView scroll=new ScrollView(this);original=new TextView(this);original.setTextColor(-1);original.setTextSize(16);original.setTextIsSelectable(true);original.setPadding(18,8,18,8);scroll.addView(original);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        capture=new Button(this);capture.setOnClickListener(v->takePicture());root.addView(capture);
        use=new Button(this);use.setText("使用这面文字，返回核对");use.setOnClickListener(v->{if(completed || processing || !PackagingOcrText.valid(capturedText))return;completed=true;setResult(RESULT_OK,new Intent().putExtra("text",capturedText));finish();});root.addView(use);
        Button cancel=new Button(this);cancel.setText("取消文字识别");cancel.setOnClickListener(v->finish());root.addView(cancel);
        setContentView(root);ViewCompat.requestApplyInsets(root);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){finish();}});
        render("请对准包装，点击拍摄识别");
    }
    private void render(String message) {
        status.setText(message);original.setText(capturedText);
        capture.setText(processing?"正在识别这一面…":capturedText.isEmpty()?"拍摄识别这一面":"重拍这一面（替换当前文字）");
        capture.setEnabled(active && !processing && cameraCapture!=null);
        use.setEnabled(active && !processing && PackagingOcrText.valid(capturedText));
    }
    private void takePicture() {
        if(!active || completed || processing || cameraCapture==null)return;
        processing=true;capturedText="";render("正在识别刚拍摄的这一面，请稍候");
        long token=generation;
        try { cameraCapture.takePicture(ContextCompat.getMainExecutor(this),new ImageCapture.OnImageCapturedCallback(){
            @Override @androidx.camera.core.ExperimentalGetImage public void onCaptureSuccess(ImageProxy proxy) {
                if(!active || completed || generation!=token || proxy.getImage()==null){proxy.close();if(active && generation==token){processing=false;render("没有拍到有效画面，请重拍");}return;}
                try {
                    InputImage image=InputImage.fromMediaImage(proxy.getImage(),proxy.getImageInfo().getRotationDegrees());
                    recognizer.process(image).addOnSuccessListener(result->{
                        if(!active || completed || generation!=token)return;
                        String raw=result.getText();capturedText=PackagingOcrText.limit(raw);processing=false;
                        render(capturedText.trim().isEmpty()?"没有识别到文字，请拍清包装后重试":raw.length()>4000?"已识别；仅保留前4000字符，请核对原文":"已识别这次拍摄的原文，请核对后使用；可重拍");
                    }).addOnFailureListener(error->{if(active && !completed && generation==token){processing=false;capturedText="";render("这一面识别失败，请重拍或返回手动填写");}}).addOnCompleteListener(task->proxy.close());
                } catch(Exception e){proxy.close();if(active && generation==token){processing=false;render("图片识别失败，请重拍");}}
            }
            @Override public void onError(ImageCaptureException e){if(active && !completed && generation==token){processing=false;render("拍摄失败，请重试或返回手动填写");}}
        }); } catch(Exception e){processing=false;render("无法拍摄，请重试或返回手动填写");}
    }
    @Override protected void onResume(){
        super.onResume();if(completed)return;
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){fail("相机权限已关闭，请允许后重试","CAMERA_DENIED");return;}
        active=true;generation++;processing=false;long token=generation;cameraCapture=null;render(PackagingOcrText.valid(capturedText)?"已恢复这次拍摄的原文，请核对后使用":"正在启动相机");
        ListenableFuture<ProcessCameraProvider> future=ProcessCameraProvider.getInstance(this);
        future.addListener(()->{if(!active || completed || generation!=token)return;try{
            provider=future.get();provider.unbindAll();Preview p=new Preview.Builder().build();p.setSurfaceProvider(preview.getSurfaceProvider());
            cameraCapture=new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build();
            CameraSelector selector=provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)?CameraSelector.DEFAULT_BACK_CAMERA:CameraSelector.DEFAULT_FRONT_CAMERA;
            provider.bindToLifecycle(this,selector,p,cameraCapture);render(PackagingOcrText.valid(capturedText)?"已恢复这次拍摄的原文，请核对后使用":"请对准包装，点击拍摄识别");
        }catch(Exception e){fail("无法启动摄像头，请重试或手动填写","CAMERA_UNAVAILABLE");}},ContextCompat.getMainExecutor(this));
    }
    private void fail(String message,String code){if(completed)return;completed=true;setResult(RESULT_CANCELED,new Intent().putExtra("error",message).putExtra("code",code));finish();}
    @Override protected void onSaveInstanceState(Bundle out){out.putString("text",capturedText);super.onSaveInstanceState(out);}
    @Override protected void onPause(){active=false;generation++;processing=false;cameraCapture=null;if(provider!=null)provider.unbindAll();super.onPause();}
    @Override protected void onDestroy(){active=false;completed=true;generation++;if(provider!=null)provider.unbindAll();if(recognizer!=null)recognizer.close();super.onDestroy();}
}
