package com.inventory.localapp;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="InventoryOcr",permissions={@Permission(alias="camera",strings={Manifest.permission.CAMERA})})
public class InventoryOcrPlugin extends Plugin {
    private final AtomicBoolean busy=new AtomicBoolean(false);
    private PluginCall pending;
    @PluginMethod public void capture(PluginCall call) {
        if(!busy.compareAndSet(false,true)){call.reject("包装文字识别正在进行，请先完成或取消","OCR_BUSY");return;}
        pending=call;
        if(!CameraOperationGate.acquire(this)){fail(call,"相机正在用于扫码或包装识别，请先完成或取消","OCR_BUSY");return;}
        if(!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)){fail(call,"此设备没有可用摄像头，请手动填写","NO_CAMERA");return;}
        try { if(getPermissionState("camera")!=PermissionState.GRANTED)requestPermissionForAlias("camera",call,"cameraPermissionResult");else launch(call); }
        catch(Exception e){fail(call,"无法启动包装文字识别，请重试或手动填写","OCR_FAILED");}
    }
    @PermissionCallback private void cameraPermissionResult(PluginCall call) {
        if(call==null){CameraOperationGate.release(this);busy.set(false);pending=null;return;}
        if(getPermissionState("camera")!=PermissionState.GRANTED){fail(call,"未获得相机权限，请在系统设置中允许或手动填写","CAMERA_DENIED");return;}
        launch(call);
    }
    private void launch(PluginCall call) {
        if(getActivity()==null || getActivity().isFinishing() || getActivity().isDestroyed()){fail(call,"包装文字识别已中断，请重新打开","OCR_INTERRUPTED");return;}
        getActivity().runOnUiThread(()-> {try {if(pending!=call || !busy.get())return; startActivityForResult(call,new Intent(getContext(),PackagingOcrActivity.class),"captureResult");}catch(Exception e){fail(call,"无法打开拍摄页面，请重试或手动填写","OCR_FAILED");}});
    }
    @ActivityCallback private void captureResult(PluginCall call,ActivityResult activityResult) {
        CameraOperationGate.release(this);busy.set(false);pending=null;if(call==null)return;
        Intent data=activityResult.getData();
        if(data!=null && data.hasExtra("error")){call.reject(data.getStringExtra("error"),data.getStringExtra("code"));return;}
        JSObject result=new JSObject();
        if(activityResult.getResultCode()!=Activity.RESULT_OK || data==null) result.put("cancelled",true);
        else {String text=data.getStringExtra("text");if(!PackagingOcrText.valid(text)){call.reject("未获得有效包装文字，请重拍或手动填写","INVALID_RESULT");return;}result.put("cancelled",false);result.put("text",text);}
        call.resolve(result);
    }
    private void fail(PluginCall call,String message,String code){CameraOperationGate.release(this);busy.set(false);pending=null;call.reject(message,code);}
    @Override protected void handleOnDestroy(){CameraOperationGate.release(this);if(pending!=null)fail(pending,"包装文字识别已中断，请重新打开","OCR_INTERRUPTED");busy.set(false);super.handleOnDestroy();}
}
