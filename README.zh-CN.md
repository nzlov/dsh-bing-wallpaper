# DSH Bing 每日壁纸

简体中文 · [English](README.md)

为 DSH Web 添加每日 Bing 壁纸、从图片提取的主题色，以及自动日夜外观。

![DSH Web 中的 Bing 每日壁纸设置示例：壁纸预览、来源选择及图片取色风格](<assets/settings-preview.png>)

## 特性

- 每日 Bing 壁纸可选中国或美国来源，支持 1080p、2K 和 4K。可自动更新、手动刷新，查看照片标题、日期和版权信息。
- 根据壁纸为界面、代码高亮和差异视图配色。提供十种取色风格、浅色与深色预览、高对比度文字和纯黑深色模式。
- 外观可跟随系统或 DSH、定时切换，也可固定为浅色或深色。
- 壁纸可见度可调，支持模糊、毛玻璃、蓝色调、黑白和压暗滤镜。左右侧栏可分别选择壁纸或主题纯色，独立调节可见度、滤镜和主题叠色。
- 主背景与侧栏支持深度图视差和 SHARP 3D 视差，可调节强度，并遵循系统的「减少动态效果」设置。
- 天气窗景可跟随所在地天气或手动选择，支持日光、月光、云雾、雨雪和闪电。
- 多台设备可共用默认配置，也可单独调整。界面支持中文和英文。

## 安装

需要 DSH `>=0.2.2-rc.4 <0.3.0`。

在 DSH 插件管理中安装 **`@nzlov/dsh-bing-wallpaper`**，或让 DSH Agent 安装该 npm bundle。npm 包已预构建，无需手动构建。安装会影响当前 profile 的所有会话。

如需从源码安装（需要 Git、Node.js 和 npm）：

```sh
git clone https://github.com/nzlov/dsh-bing-wallpaper.git
cd dsh-bing-wallpaper
npm ci --ignore-scripts
npm run build
```

随后在 DSH 中使用本目录的绝对路径安装。

启用后打开 **设置 → Bing 每日壁纸**。源码位于 `src/`。修改源码后重新构建以更新 `dist/client.js`。更新已安装的插件时，按插件管理器提示决定是否重启。

### 可选视差模式

在 **设置 → Bing 每日壁纸 → 视差模式** 中选择模式。**深度图（Depth Anything）** 根据远近移动原图像素。**3D 场景（SHARP）** 随视角移动显示模型推测的遮挡区域。设置页预览显示原图。

启用 **深度图** 时，在对应的 DSH profile 中安装 `@huggingface/transformers` 后重启 DSH。

```sh
dsh plugin --profile web add @huggingface/transformers
```

启用 **3D 场景（SHARP）** 时，在 DSH 服务端手动安装 Python 环境和模型权重，再重启 DSH。命令和路径见 [SHARP 手动安装指南](docs/sharp-install.zh-CN.md)。

后端按需下载 Depth Anything 模型。原图和取色结果在后端内存中复用，深度图和压缩的 SHARP 场景缓存在 `${XDG_CACHE_HOME:-$HOME/.cache}/dsh-bing-wallpaper` 下的 `depth` 和 `scenes` 目录。

浏览器加载当前壁纸的深度图或 SHARP 场景，鼠标移动时用 WebGL 实时重绘。SHARP 渲染需要 WebGL2，渲染代码随该模式按需加载。等待生成、开启「减少动态效果」或渲染不可用时显示原图。

## 天气效果

在 **设置 → Bing 每日壁纸** 中打开 **天气选择**，可选择 **关闭**、**跟随位置**，也可以直接选择 **多云**、**大雨**等窗景。选中的窗景立即生效。跟随位置时，填写城市名或“纬度, 经度”，也可以点 **使用当前位置**。选择服务商后点 **应用并查询天气**，设置会显示匹配的地点和天气。

主背景与壁纸侧栏同步显示天气。雨滴会在玻璃上溅开、滑落，雪花会附着、融化。开启系统「减少动态效果」时，窗景保持静态。

「面向方向」可选东、西、南、北。浅色模式显示日光，深色模式显示月光，光线随本地时间和朝向变化。

内置 [Open-Meteo](https://open-meteo.com/) 和 [wttr.in](https://github.com/chubin/wttr.in)。在「跟随位置」模式下填写 **更新间隔（分钟）**，点 **应用并查询天气** 保存。浏览器直接向所选服务发送地点，查询成功后按设定间隔更新，默认 30 分钟，最短 1 分钟。Open-Meteo 按城市名查询时，先使用它的地理编码服务。仅「跟随位置」模式会查询天气。服务商返回的风速和来风方向会按窗景朝向换算，影响雨雪、云雾和玻璃水珠的移动。直接选择窗景时使用基础动画。自定义接口只有风速时，沿用默认向左的风。

自定义服务填写支持浏览器跨域请求（CORS）的 HTTPS 接口。浏览器发送 GET 请求并添加 `location` 参数，例如 `?location=Shanghai`。接口应返回形如 `{"current":{"weather_code":61,"wind_speed_10m":18,"wind_direction_10m":90}}` 的 JSON，其中 `weather_code` 是 [WMO 天气代码](https://open-meteo.com/en/docs#weather_variable_documentation)。可选的 `wind_speed_10m` 单位为 km/h，`wind_direction_10m` 是来风方向，以北为 0° 顺时针计量，90° 表示东风。

## 使用须知

- 无需 API Key 或 CDN。壁纸源仅访问固定 Bing HTTPS 接口，不向 Bing 发送聊天内容或浏览器凭据。
- Bing 原图在服务端内存中按小时缓存，点击刷新可能复用上一张。两个地区也可能展示同一张照片。
- 新设备自动读取当前 profile 的默认配置。点 **保存为默认** 将当前配置（含天气地点和自定义接口）保存到后端。之后在任一设备调整设置，只影响该浏览器。点 **使用默认配置** 可替换本机设置并恢复跟随。升级前已有的浏览器配置会保留。
- DSH 的外观偏好由整个 profile 共享。建议仅在一个主要浏览器启用定时切换，避免不同时间表互相覆盖。

## 许可与版权

作者：[nzlov](https://github.com/nzlov)。

- 插件代码及原创 SVG 图标采用 [MIT 许可](LICENSE)。
- Material Color Utilities 采用 Apache-2.0，详见[第三方声明](third-party/NOTICES.md)及[附带许可](third-party/material-color-utilities-LICENSE.txt)。
- 图片版权归 Bing 及原摄影作者所有。插件许可不包含图片的再分发或商业使用授权，请遵守每张图片所附版权链接中的条款。
