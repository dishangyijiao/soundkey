# 讽诵

摘下一句，朗读，看哪个音没读准。

## 准备

本机需要 `espeak-ng`。音素模型第一次导出：

```bash
cargo run --release -- setup
```

## 运行

```bash
cargo run --release -- serve
```

Chrome 打开 `chrome://extensions`，打开开发者模式，加载已解压的扩展，选这个项目里的 `extension` 目录。打开 YouTube 后点扩展图标，右侧就是讽诵。

程序听在 `http://127.0.0.1:17321`。卡片和录音在 `~/Library/Application Support/fengsong/`。
