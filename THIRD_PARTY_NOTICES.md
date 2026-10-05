# 第三方组件

本项目原有源码 LICENSE 与第三方组件许可证分别适用。以下为新增本地解析路径的组件说明，不是把整个桌面分发认定为 Apache-2.0。

## PyMuPDF 1.28.0 / MuPDF

- 上游源码：https://github.com/pymupdf/PyMuPDF/tree/1.28.0
- 项目与许可：https://github.com/pymupdf/PyMuPDF
- 上游提供 GNU AGPL 与 Artifex 商业授权选项，参照所用安装包中的 COPYING 与上游说明。
- 本地解析代码为 `server/native/pdf_engine.py`，构建入口为 `scripts/build-parser.mjs`，依赖版本在 `server/native/requirements.txt`。
- 桌面解析器打包时复制安装包附带的 COPYING，并附此说明。此处提供源码与构建入口信息，不能替代对完整分发所需许可证和对应源码的准备。对外发布安装包前需核对完整的第三方许可与源码提供义务。

## PyInstaller 6.21.0

- https://github.com/pyinstaller/pyinstaller
- GPL 带启动程序分发例外，详见上游 COPYING.txt。构建解析器时复制已安装版本附带的许可证。

## PDF.js / Electron / Tesseract

- PDF.js：https://github.com/mozilla/pdf.js （Apache-2.0）
- Electron：https://github.com/electron/electron （MIT，另有 Chromium/Node 等组件声明，由 Electron 分发附带）
- 可选 OCR 语言数据：https://github.com/tesseract-ocr/tessdata_fast （参见上游 LICENSE；本项目安装包暂不捆绑语言模型）

个人非商业使用不是对第三方许可证的替代。主项目其余依赖以各自 npm 包与 LICENSE 为准。
