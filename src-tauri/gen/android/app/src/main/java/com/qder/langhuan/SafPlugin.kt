package com.qder.langhuan

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

@InvokeArg
class SafWriteTextArgs {
  lateinit var path: String
  lateinit var content: String
}

@InvokeArg
class SafWriteBytesArgs {
  lateinit var path: String
  lateinit var base64: String
}

/**
 * Storage Access Framework: persist a user-picked tree, then read/write notes.
 *
 * WebView showDirectoryPicker NPEs on this shell; this is the Android-only
 * replacement used by 本地文件夹同步.
 *
 * Registered from Rust via register_android_plugin("com.qder.langhuan", "SafPlugin").
 */
@TauriPlugin
class SafPlugin(private val activity: Activity) : Plugin(activity) {
  private val prefs
    get() = activity.getSharedPreferences("langhuan_saf", Activity.MODE_PRIVATE)

  @Command
  fun pickTree(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }
    startActivityForResult(invoke, intent, "onPickTree")
  }

  @ActivityCallback
  fun onPickTree(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("已取消选择文件夹")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      invoke.reject("未选择文件夹")
      return
    }
    try {
      val takeFlags =
        (result.data?.flags ?: 0) and
          (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      val flags =
        if (takeFlags != 0) takeFlags
        else Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      activity.contentResolver.takePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // Some providers still allow the session; keep going and report writable below.
    }
    val doc = DocumentFile.fromTreeUri(activity, uri)
    val name = doc?.name ?: "文件夹"
    prefs.edit()
      .putString(KEY_URI, uri.toString())
      .putString(KEY_NAME, name)
      .apply()
    invoke.resolve(boundObject(true, uri.toString(), name, doc?.canWrite() == true))
  }

  @Command
  fun getBound(invoke: Invoke) {
    val uriStr = prefs.getString(KEY_URI, null)
    if (uriStr.isNullOrBlank()) {
      invoke.resolve(boundObject(false, "", "", false))
      return
    }
    val uri = Uri.parse(uriStr)
    val doc = DocumentFile.fromTreeUri(activity, uri)
    val name = prefs.getString(KEY_NAME, null) ?: doc?.name ?: "文件夹"
    val writable = doc != null && doc.canRead()
    invoke.resolve(boundObject(true, uriStr, name, writable && doc?.canWrite() == true))
  }

  @Command
  fun unbind(invoke: Invoke) {
    val uriStr = prefs.getString(KEY_URI, null)
    if (!uriStr.isNullOrBlank()) {
      try {
        val uri = Uri.parse(uriStr)
        activity.contentResolver.releasePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (_: Exception) {
        /* already gone */
      }
    }
    prefs.edit().remove(KEY_URI).remove(KEY_NAME).apply()
    invoke.resolve()
  }

  @Command
  fun scanTree(invoke: Invoke) {
    Thread {
      try {
        val root = requireRoot()
        val docs = JSArray()
        val assets = JSArray()
        var truncated = false
        var skipped = 0
        var fileCount = 0
        var totalBytes = 0L

        fun walk(dir: DocumentFile, prefix: String, depth: Int) {
          if (truncated || depth > MAX_DEPTH) return
          val children = dir.listFiles() ?: return
          for (child in children) {
            if (truncated) return
            val name = child.name ?: continue
            if (shouldIgnore(name)) {
              skipped += 1
              continue
            }
            val path = if (prefix.isEmpty()) name else "$prefix/$name"
            if (child.isDirectory) {
              walk(child, path, depth + 1)
              continue
            }
            if (!child.isFile) continue
            fileCount += 1
            if (fileCount > MAX_FILES) {
              truncated = true
              return
            }
            val size = child.length()
            if (size > MAX_FILE_BYTES) {
              skipped += 1
              continue
            }
            if (totalBytes + size > MAX_TOTAL_BYTES) {
              truncated = true
              return
            }
            val lower = name.lowercase()
            when {
              isTextNote(lower) -> {
                val text = readUtf8(child)
                totalBytes += size
                val item = JSObject()
                item.put("path", path)
                item.put("content", text)
                item.put("mtime", child.lastModified())
                item.put("size", size)
                docs.put(item)
              }
              isImage(lower) -> {
                val bytes = readBytes(child)
                totalBytes += bytes.size.toLong()
                val item = JSObject()
                item.put("path", path)
                item.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                item.put("mime", mimeForImage(lower))
                item.put("mtime", child.lastModified())
                item.put("size", bytes.size.toLong())
                assets.put(item)
              }
              else -> skipped += 1
            }
          }
        }

        walk(root, "", 0)
        val out = JSObject()
        out.put("docs", docs)
        out.put("assets", assets)
        out.put("truncated", truncated)
        out.put("skipped", skipped)
        activity.runOnUiThread { invoke.resolve(out) }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "读取文件夹失败") }
      }
    }.start()
  }

  @Command
  fun writeText(invoke: Invoke) {
    val args = invoke.parseArgs(SafWriteTextArgs::class.java)
    Thread {
      try {
        writeBytes(requireRoot(), args.path, args.content.toByteArray(StandardCharsets.UTF_8))
        activity.runOnUiThread { invoke.resolve() }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "写入失败") }
      }
    }.start()
  }

  @Command
  fun writeBytes(invoke: Invoke) {
    val args = invoke.parseArgs(SafWriteBytesArgs::class.java)
    Thread {
      try {
        val raw = Base64.decode(args.base64, Base64.DEFAULT)
        writeBytes(requireRoot(), args.path, raw)
        activity.runOnUiThread { invoke.resolve() }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "写入失败") }
      }
    }.start()
  }

  private fun boundObject(bound: Boolean, uri: String, name: String, writable: Boolean): JSObject {
    val out = JSObject()
    out.put("bound", bound)
    out.put("uri", uri)
    out.put("name", name)
    out.put("writable", writable)
    return out
  }

  private fun requireRoot(): DocumentFile {
    val uriStr = prefs.getString(KEY_URI, null)
      ?: throw IllegalStateException("尚未绑定文件夹")
    val doc = DocumentFile.fromTreeUri(activity, Uri.parse(uriStr))
      ?: throw IllegalStateException("绑定已失效，请重新选择文件夹")
    if (!doc.canRead()) {
      throw IllegalStateException("没有读取权限，请重新选择文件夹")
    }
    return doc
  }

  private fun writeBytes(root: DocumentFile, relPath: String, data: ByteArray) {
    val parts = sanitizePath(relPath)
    if (parts.isEmpty()) throw IllegalArgumentException("路径无效")
    var dir = root
    for (i in 0 until parts.size - 1) {
      val name = parts[i]
      var next = dir.findFile(name)
      if (next == null || !next.isDirectory) {
        next = dir.createDirectory(name)
          ?: throw IllegalStateException("无法创建目录 $name")
      }
      dir = next
    }
    val fileName = parts.last()
    var file = dir.findFile(fileName)
    if (file != null && file.isDirectory) {
      throw IllegalStateException("$fileName 已是文件夹")
    }
    if (file == null) {
      file = dir.createFile("application/octet-stream", fileName)
        ?: throw IllegalStateException("无法创建文件 $fileName")
    }
    val stream = activity.contentResolver.openOutputStream(file.uri, "w")
      ?: throw IllegalStateException("无法打开 $fileName")
    stream.use { it.write(data) }
  }

  private fun readUtf8(file: DocumentFile): String {
    return String(readBytes(file), StandardCharsets.UTF_8)
  }

  private fun readBytes(file: DocumentFile): ByteArray {
    val stream = activity.contentResolver.openInputStream(file.uri)
      ?: throw IllegalStateException("无法读取 ${file.name}")
    stream.use { input ->
      val out = ByteArrayOutputStream()
      val buf = ByteArray(16 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        out.write(buf, 0, n)
      }
      return out.toByteArray()
    }
  }

  companion object {
    private const val KEY_URI = "treeUri"
    private const val KEY_NAME = "treeName"
    private const val MAX_DEPTH = 20
    private const val MAX_FILES = 2000
    private const val MAX_FILE_BYTES = 8L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 64L * 1024 * 1024

    private val IGNORED = setOf(
      "__MACOSX",
      ".DS_Store",
      "Thumbs.db",
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      ".langhuan"
    )

    fun shouldIgnore(name: String): Boolean {
      if (name.isEmpty()) return true
      if (IGNORED.contains(name)) return true
      if (name.startsWith(".") && name != ".gitignore") return true
      return false
    }

    fun isTextNote(lowerName: String): Boolean {
      return lowerName.endsWith(".md") ||
        lowerName.endsWith(".html") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".svg")
    }

    fun isImage(lowerName: String): Boolean {
      return lowerName.endsWith(".png") ||
        lowerName.endsWith(".jpg") ||
        lowerName.endsWith(".jpeg") ||
        lowerName.endsWith(".gif") ||
        lowerName.endsWith(".webp") ||
        lowerName.endsWith(".bmp") ||
        lowerName.endsWith(".avif")
    }

    fun mimeForImage(lowerName: String): String {
      return when {
        lowerName.endsWith(".png") -> "image/png"
        lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") -> "image/jpeg"
        lowerName.endsWith(".gif") -> "image/gif"
        lowerName.endsWith(".webp") -> "image/webp"
        lowerName.endsWith(".bmp") -> "image/bmp"
        lowerName.endsWith(".avif") -> "image/avif"
        else -> "application/octet-stream"
      }
    }

    fun sanitizePath(relPath: String): List<String> {
      val parts = mutableListOf<String>()
      for (seg in relPath.replace('\\', '/').split('/')) {
        if (seg.isEmpty() || seg == ".") continue
        if (seg == "..") throw IllegalArgumentException("路径无效")
        parts.add(seg)
      }
      return parts
    }
  }
}
