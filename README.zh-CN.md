# DSH Bing 每日壁纸

简体中文 · [English](README.md)

为 DSH Web 添加每日 Bing 壁纸、从图片提取的主题色，以及自动日夜外观。独立插件，不修改 DSH 本体。

![DSH Web 中的 Bing 每日壁纸设置示例：壁纸预览、来源选择及图片取色风格](<assets/settings-preview.png>)

## 特性

- 国内（中国）与国际（美国）Bing 来源，缓存独立，失败时不自动混用其他来源。
- 十种取色风格：M3 Content、M3 Tonal Spot、M3 Fruit Salad、M3 Rainbow、M3 Monochrome、Vibrant、Faithful、Soft、Dysfunctional、Muted。
- M3 风格从图片颜色中评分选择源色；五种自定义风格聚类提取多个候选色，并按风格选择。算法参考 Noctalia，并针对浏览器采样、候选色选择和 DSH 可读性做了调整，结果不保证逐像素一致。
- 平铺配色卡片，日夜预览以斜线分隔，点击即可切换。
- 壁纸可见度 10%–100%，不强制叠加阅读蒙层；图标及语义状态色不重新染色。
- 支持模糊（Blur）、毛玻璃（模糊加雾面）、蓝色调、黑白和压暗滤镜，可分别调节强度并实时作用于背景；设置页预览和主题色提取使用原图。
- 主页面、侧栏及启动占位页均使用独立的壁纸滤镜层和纯色兜底；页面内容、文档图片和图表不受背景滤镜影响。
- 左右侧栏可独立选择壁纸或主题纯色，可见度和滤镜可跟随主背景或单独调节，并可设置控制条背景是否跟随侧栏。可见度跟随主背景时，侧栏设置默认收起。壁纸与中间区域共用视口坐标，缩放、分栏及抽屉动画中保持连续；纯色和“叠加主题色”均使用下方配色示例的侧栏色，叠色强度独立于壁纸可见度，可独立关闭。桌面与移动端共用设置。
- 支持定时、跟随系统、跟随 DSH，以及固定浅色或深色。默认按浏览器本地时间在 07:00–19:00 使用浅色。
- 标题、日期、来源与版权叠放在图片底部，右上角提供刷新图标。
- 自动检查更新，失败保留上一张图片；界面支持中英文。

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

启用后打开 **设置 → Bing 每日壁纸**。修改源码后需重新构建；更新已安装的插件时，按插件管理器提示决定是否重启。

## 使用须知

- 无需 API Key 或 CDN。上游仅访问固定 Bing HTTPS 接口，不向 Bing 发送聊天内容或浏览器凭据。
- 图片仅缓存在内存，不提供离线壁纸库。服务端按小时缓存，因此点击刷新不一定下载新图；两个地区也可能展示同一张照片。
- 插件控制项保存在当前浏览器，DSH 的外观偏好则由整个 profile 共享。建议仅在一个主要浏览器启用定时切换，避免不同时间表互相覆盖。

## 许可与版权

作者：[nzlov](https://github.com/nzlov)。

- 插件代码及原创 SVG 图标采用 [MIT 许可](LICENSE)。
- Material Color Utilities 采用 Apache-2.0，详见[第三方声明](THIRD_PARTY_NOTICES.md)及[附带许可](third-party/material-color-utilities-LICENSE.txt)。
- 图片版权归 Bing 及原摄影作者所有。插件许可不包含图片的再分发或商业使用授权，请遵守每张图片所附版权链接中的条款。
