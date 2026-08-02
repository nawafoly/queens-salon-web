package com.Malikatsalon.staff;

import android.app.ActivityManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityManager.TaskDescription description =
                new ActivityManager.TaskDescription.Builder()
                    .setLabel(getString(R.string.app_name))
                    .setIcon(R.mipmap.ic_launcher)
                    .setPrimaryColor(getColor(R.color.ic_launcher_background))
                    .build();

            setTaskDescription(description);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            setTaskDescription(
                new ActivityManager.TaskDescription(
                    getString(R.string.app_name),
                    R.mipmap.ic_launcher,
                    getColor(R.color.ic_launcher_background)
                )
            );
        }
    }
}
