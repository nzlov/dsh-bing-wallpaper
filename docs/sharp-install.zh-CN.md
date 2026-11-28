# 手动安装 SHARP

简体中文 · [English](sharp-install.md)

在运行 DSH Web 的机器上安装 SHARP，使用当前 DSH profile 的 `model-runtime/sharp` 目录。Linux 和 macOS 上默认 `web` profile 的路径是 `${DSH_HOME:-$HOME/.dsh}/profiles/web`。如服务使用其他 profile 或 DSH 数据目录，请使用实际的绝对路径。

插件在该目录查找 `venv/bin/python`（Windows 为 `venv/Scripts/python.exe`）和 `sharp_2572gikvuh.pt`。运行 DSH 的账号需要能访问这两个文件。如果已在其他目录安装，请参照 [复用已有环境](#复用已有环境)。

## 在 Linux 或 macOS 安装

1. 确保服务端有 Git、`curl` 和 Python 3.13，再创建虚拟环境。以下命令使用默认的 `web` profile，并固定到已验证的 Apple 源码版本。[Apple 安装说明](https://github.com/apple-aiml-research/ml-sharp#getting-started)

   ```sh
   sharp_dir="${DSH_HOME:-$HOME/.dsh}/profiles/web/model-runtime/sharp"
   mkdir -p "$sharp_dir"
   python3.13 -m venv "$sharp_dir/venv"
   sharp_python="$sharp_dir/venv/bin/python"

   git clone https://github.com/apple-aiml-research/ml-sharp.git "$sharp_dir/ml-sharp"
   git -C "$sharp_dir/ml-sharp" checkout --detach aed6527499ef91cba3b54c18d49a870f25947190
   ```

2. 在源码目录安装依赖，确认可以导入推理入口。Apple 的依赖文件会以可编辑模式安装源码，请保留该目录。

   ```sh
   cd "$sharp_dir/ml-sharp"
   "$sharp_python" -m pip install -r requirements.txt
   "$sharp_python" -I -c 'import torch; from sharp.cli.predict import predict_image; print(torch.__version__)'
   ```

3. 从 Apple 下载约 2.81 GB 的模型权重。已有该文件时，可以直接放到同一位置，使用下方命令中的最终文件名。Apple 将这些权重的使用范围限定为非商业科学研究和学术开发。[模型许可](https://github.com/apple-aiml-research/ml-sharp/blob/main/LICENSE_MODEL)

   ```sh
   curl --fail --location \
     --output "$sharp_dir/sharp_2572gikvuh.pt.part" \
     https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt && \
     mv "$sharp_dir/sharp_2572gikvuh.pt.part" "$sharp_dir/sharp_2572gikvuh.pt"
   ```

4. 通过平时使用的启动程序或服务管理器重启 DSH。刷新浏览器，然后进入 **设置 → Bing 每日壁纸 → 视差模式**，选择 **3D 场景（SHARP）**。

## 复用已有环境

如果 SHARP 环境和权重已经位于默认位置，重启 DSH 后即可选择该模式。如果要继续使用其他目录，请在启动 DSH 的环境中设置以下两个绝对路径。插件优先使用这组路径，修改后需要重启 DSH。

```sh
export BDT_SHARP_PYTHON=/absolute/path/to/sharp-venv/bin/python
export BDT_SHARP_CHECKPOINT=/absolute/path/to/sharp_2572gikvuh.pt
```

Windows 下使用虚拟环境中的 `Scripts\python.exe`，并在启动 DSH 的终端或服务里设置这两个变量。
