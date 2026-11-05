package com.qder.langhuan

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

/**
 * Android in-app update helpers:
 * - getVersion → versionCode / versionName from PackageManager
 * - installApk → FileProvider + ACTION_VIEW package installer
 *
 * Registered from Rust via register_android_plugin("com.qder.langhuan", "UpdaterPlugin").
 */
@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun getVersion(invoke: Invoke) {
    try {
      val pm = activity.packageManager
      val pkg = activity.packageName
      val info = if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkg, 0)
      }
      val code = if (Build.VERSION.SDK_INT >= 28) {
        info.longVersionCode.toInt()
      } else {
        @Suppress("DEPRECATION")
        info.versionCode
      }
      val out = JSObject()
      out.put("versionCode", code)
      out.put("versionName", info.versionName ?: "")
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "读取版本失败")
    }
  }

  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallApkArgs::class.java)
      val file = File(args.path)
      if (!file.isFile) {
        invoke.reject("更新包文件不存在，请重新下载。")
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
          val settings = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}")
          )
          settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          activity.startActivity(settings)
          invoke.reject("UNKNOWN_SOURCES:需要允许「安装未知应用」。已打开系统设置，开启后请返回琅嬛再点安装。")
          return
        }
      }

      val authority = "${activity.packageName}.fileprovider"
      val uri = FileProvider.getUriForFile(activity, authority, file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "无法打开系统安装界面")
    }
  }
}
