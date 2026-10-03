package com.inventory.localapp;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name="InventoryOcr",permissions={@Permission(alias="camera",strings={Manifest.permission.CAMERA})})
public class InventoryOcrPlugin extends Plugin {
    private final InventoryPendingOperation<PluginCall> operation=new InventoryPendingOperation<>();
    @PluginMethod public void capture(PluginCall call) {
        if(!operation.begin(call)){call.reject("包装文字识别正在进行，请先完成或取消","OCR_BUSY");return;}
        if(!CameraOperationGate.acquire(this)){fail(call,"相机正在用于扫码或包装识别，请先完成或取消","OCR_BUSY");return;}
        if(!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)){fail(call,"此设备没有可用摄像头，请手动填写","NO_CAMERA");return;}
        try { if(getPermissionState("camera")!=PermissionState.GRANTED)requestPermissionForAlias("camera",call,"cameraPermissionResult");else launch(call); }
        catch(Exception e){fail(call,"无法启动包装文字识别，请重试或手动填写","OCR_FAILED");}
    }
    @PermissionCallback private void cameraPermissionResult(PluginCall call) {
        if(call==null){rejectOrphanedCall();return;}
        if(!operation.isCurrent(call))return;
        if(getPermissionState("camera")!=PermissionState.GRANTED){fail(call,"未获得相机权限，请在系统设置中允许或手动填写","CAMERA_DENIED");return;}
        launch(call);
    }
    private void launch(PluginCall call) {
        if(getActivity()==null || getActivity().isFinishing() || getActivity().isDestroyed()){fail(call,"包装文字识别已中断，请重新打开","OCR_INTERRUPTED");return;}
        getActivity().runOnUiThread(()-> {try {if(!operation.claimLaunch(call))return; startActivityForResult(call,new Intent(getContext(),PackagingOcrActivity.class),"captureResult");}catch(Exception e){fail(call,"无法打开拍摄页面，请重试或手动填写","OCR_FAILED");}});
    }
    @ActivityCallback private void captureResult(PluginCall call,ActivityResult activityResult) {
        if(call==null){rejectOrphanedCall();return;}
        if(!operation.finishResult(call,call!=null && PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())))return;
        CameraOperationGate.release(this);
        Intent data=activityResult.getData();
        if(data!=null && data.hasExtra("error")){call.reject(data.getStringExtra("error"),data.getStringExtra("code"));return;}
        JSObject result=new JSObject();
        if(activityResult.getResultCode()!=Activity.RESULT_OK || data==null) result.put("cancelled",true);
        else {String text=data.getStringExtra("text");if(!PackagingOcrText.valid(text)){call.reject("未获得有效包装文字，请重拍或手动填写","INVALID_RESULT");return;}result.put("cancelled",false);result.put("text",text);}
        call.resolve(result);
    }
    private void fail(PluginCall call,String message,String code){if(!operation.finish(call))return;CameraOperationGate.release(this);call.reject(message,code);}
    private void rejectOrphanedCall(){PluginCall call=operation.current();if(call!=null && getBridge().getSavedCall(call.getCallbackId())==null)fail(call,"包装文字识别已中断，请重新打开","OCR_INTERRUPTED");}
    @Override protected void handleOnDestroy(){PluginCall call=operation.destroy();CameraOperationGate.release(this);if(call!=null)call.reject("包装文字识别已中断，请重新打开","OCR_INTERRUPTED");super.handleOnDestroy();}
}
