# 讽诵

摘下一句，朗读，看哪个音没读准。

## 准备

本机需要 `espeak-ng`。音素模型第一次导出：

```bash
cargo run --release -- setup
```

首次使用生词查询前，安装本地 ECDICT 词库（需要网络和 `curl`）：

```bash
cargo run --release -- setup-dict
```

命令会显示下载体积，并把只含单词、音标、释义和词形字段的 SQLite 词库写入应用数据目录；ECDICT 上游提供约 76 万条基础词目，按 [MIT 许可](https://github.com/skywind3000/ECDICT/blob/master/LICENSE) 使用，许可证副本会保存在本机。

## 运行

```bash
cargo run --release -- serve
```

Chrome 打开 `chrome://extensions`，打开开发者模式，加载已解压的扩展，选这个项目里的 `extension` 目录。打开 YouTube 后点扩展图标，右侧就是讽诵。

程序听在 `http://127.0.0.1:17321`。卡片和录音在 `~/Library/Application Support/fengsong/`。
