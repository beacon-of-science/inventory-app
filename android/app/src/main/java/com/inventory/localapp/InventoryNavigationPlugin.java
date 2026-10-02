package com.inventory.localapp;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.app.Activity;

@CapacitorPlugin(name="InventoryNavigation")
public class InventoryNavigationPlugin extends Plugin {
    @PluginMethod public void minimize(PluginCall call) {
        Activity activity=getActivity();
        if(activity==null || activity.isFinishing() || activity.isDestroyed()){call.reject("当前页面已关闭，请重新打开应用","NAV_INTERRUPTED");return;}
        activity.runOnUiThread(()-> {
            if(activity.isFinishing() || activity.isDestroyed()){call.reject("当前页面已关闭，请重新打开应用","NAV_INTERRUPTED");return;}
            try {activity.moveTaskToBack(true);call.resolve();}
            catch(Exception error){call.reject("暂时无法返回桌面，请重试","NAV_FAILED");}
        });
    }
}
