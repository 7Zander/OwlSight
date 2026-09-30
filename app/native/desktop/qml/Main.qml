// SPDX-License-Identifier: GPL-3.0-or-later
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs
import OwlSight 1.0

ApplicationWindow {
    id: win
    width: 1280; height: 800; minimumWidth: 640; minimumHeight: 420
    visible: true; color: "#181818"; title: "OwlSight · Qt Quick"
    flags: Qt.Window | Qt.FramelessWindowHint
    font.family: "Microsoft YaHei UI"; font.pixelSize: 13
    property var s: viewer.state
    property bool pinned: false
    property bool full: visibility === Window.FullScreen
    property real zoom: 1
    property real panX: 0
    property real panY: 0
    property int menuPage: 0
    function fitImage() { zoom=1; panX=0; panY=0 }
    function fullScreen() { if(full) showNormal(); else showFullScreen() }
    function pinWindow() { pinned=!pinned; flags=Qt.Window|Qt.FramelessWindowHint|(pinned?Qt.WindowStaysOnTopHint:0); show() }
    function act(name,value) { viewer.command(name,value === undefined ? null : value) }
    function menuAt(x,y) { menu.anchorX=x; menu.anchorY=y; menu.open() }
    palette.text: "#bcbcbc"; palette.buttonText: "#bcbcbc"; palette.window: "#252525"
    palette.base: "#202020"; palette.button: "#292929"; palette.highlight: "#365562"

    component OwlButton: Button {
        id: control
        implicitHeight: 30; padding: 7; hoverEnabled: true
        property bool selected: false
        property bool quiet: false
        contentItem: Text { text: control.text; color: control.enabled ? "#bcbcbc" : "#606060"; font: control.font; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight }
        background: Rectangle { radius: 4; color: control.down ? "#365562" : control.selected ? "#365562" : control.hovered ? "#363636" : control.quiet ? "transparent" : "#292929"; border.color: control.selected ? "#548293" : control.quiet ? "transparent" : "#484848" }
    }
    component OwlCombo: ComboBox {
        id: control
        implicitHeight: 27; font.pixelSize: 11; leftPadding: 8; rightPadding: 23
        contentItem: Text { text: control.displayText; color: "#bcbcbc"; font: control.font; verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight }
        indicator: Text { x: control.width-21; width: 16; height: control.height; text: "⌄"; color: "#999"; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; font.pixelSize: 13 }
        background: Rectangle { color: "#202020"; radius: 4; border.color: control.activeFocus ? "#548293" : "#484848" }
    }
    component OwlIcon: Canvas {
        property string name:""
        property color tint:"#bcbcbc"
        implicitWidth:18;implicitHeight:18
        onNameChanged:requestPaint()
        onTintChanged:requestPaint()
        onWidthChanged:requestPaint()
        onHeightChanged:requestPaint()
        onPaint:{
            var c=getContext("2d");c.reset();c.scale(width/24,height/24)
            c.strokeStyle=tint;c.fillStyle=tint;c.lineWidth=1.7;c.lineCap="round";c.lineJoin="round"
            if(name==="play"){c.beginPath();c.moveTo(8,5);c.lineTo(19,12);c.lineTo(8,19);c.closePath();c.fill()}
            else if(name==="pause"){c.fillRect(6,5,4,14);c.fillRect(14,5,4,14)}
            else if(name==="pin"){
                c.beginPath();c.moveTo(8,3);c.lineTo(16,3);c.lineTo(15,10);c.lineTo(18,14);c.lineTo(6,14);c.lineTo(9,10);c.closePath();c.stroke()
                c.beginPath();c.moveTo(12,14);c.lineTo(12,21);c.stroke()
            }else if(name==="loop"){
                c.beginPath();c.moveTo(5,10);c.lineTo(5,8);c.quadraticCurveTo(5,5,8,5);c.lineTo(20,5);c.lineTo(17,2);c.moveTo(20,5);c.lineTo(17,8);c.stroke()
                c.beginPath();c.moveTo(19,14);c.lineTo(19,16);c.quadraticCurveTo(19,19,16,19);c.lineTo(4,19);c.lineTo(7,22);c.moveTo(4,19);c.lineTo(7,16);c.stroke()
            }else if(name==="previous"||name==="next"){
                var a=name==="previous"?15:9,b=name==="previous"?8:16
                c.beginPath();c.moveTo(a,5);c.lineTo(b,12);c.lineTo(a,19);c.stroke()
            }else if(name==="minimize"){c.beginPath();c.moveTo(5,16);c.lineTo(19,16);c.stroke()}
            else if(name==="maximize"){c.strokeRect(5,5,14,14)}
            else if(name==="restore"){c.strokeRect(5,8,11,11);c.beginPath();c.moveTo(8,8);c.lineTo(8,5);c.lineTo(19,5);c.lineTo(19,16);c.lineTo(16,16);c.stroke()}
            else if(name==="close"){c.beginPath();c.moveTo(6,6);c.lineTo(18,18);c.moveTo(18,6);c.lineTo(6,18);c.stroke()}
        }
    }
    component IconButton: OwlButton {
        id:iconControl
        property string glyph:""
        property string hint:""
        implicitWidth:32;implicitHeight:30
        Accessible.name:hint
        contentItem:Item{
            implicitWidth:18;implicitHeight:18
            OwlIcon{anchors.centerIn:parent;name:iconControl.glyph;tint:!iconControl.enabled?"#606060":iconControl.selected?"#9dc5d0":"#bcbcbc"}
        }
        ToolTip.visible:hovered;ToolTip.text:hint;ToolTip.delay:500
    }
    component SettingsDivider: Rectangle {
        Layout.fillWidth:true;Layout.preferredHeight:1
        Layout.topMargin:5;Layout.bottomMargin:5;color:"#3b3b3b"
    }
    component Caption: Text { color: "#888888"; font.pixelSize: 11; verticalAlignment: Text.AlignVCenter }
    component HintCheck: CheckBox {
        id: control
        font.pixelSize: 12; implicitHeight:26; spacing:7
        indicator: Rectangle { width:14; height:14; y:(control.height-height)/2; radius:2; color:control.checked?"#365562":"#202020"; border.color:"#666"; Text { anchors.centerIn:parent; text:control.checked?"✓":""; color:"#9dc5d0";font.pixelSize:11 } }
        contentItem: Text { text: control.text; font: control.font; color: "#bcbcbc"; leftPadding: control.indicator.width+7; verticalAlignment: Text.AlignVCenter }
    }

    Rectangle {
        id: titlebar
        height: win.full ? 0 : 32; visible: !win.full; color: "#222222"; width: parent.width
        MouseArea { anchors.fill: parent; anchors.rightMargin: 144; onPressed: win.startSystemMove(); onDoubleClicked: win.visibility===Window.Maximized?win.showNormal():win.showMaximized() }
        Text { x: 13; anchors.verticalCenter: parent.verticalCenter; text: "OwlSight"; color: "#888"; font.pixelSize: 11 }
        Text { x: 76; width: parent.width-235; anchors.verticalCenter: parent.verticalCenter; text: s.title; elide: Text.ElideMiddle; color: "#666"; font.pixelSize: 11 }
        Row {
            anchors.right: parent.right
            Repeater {
                model: [{icon:"pin",tip:"置顶 · Ctrl T"},{icon:"minimize",tip:"最小化"},{icon:"maximize",tip:"最大化 / 还原"},{icon:"close",tip:"关闭"}]
                delegate: IconButton {
                    required property var modelData
                    required property int index
                    width:36; height:32; quiet:true; selected:index===0&&win.pinned
                    glyph:index===2&&win.visibility===Window.Maximized?"restore":modelData.icon
                    hint:index===0?(win.pinned?"取消置顶 · Ctrl T":"置顶 · Ctrl T"):modelData.tip
                    background: Rectangle { color: parent.hovered ? (index===3?"#aa3939":"#393939") : index===0&&win.pinned?"#393939":"transparent" }
                    onClicked: { if(index===0)win.pinWindow(); else if(index===1)win.showMinimized(); else if(index===2){if(win.visibility===Window.Maximized)win.showNormal();else win.showMaximized()}else win.close() }
                }
            }
        }
    }

    Item {
        id: canvas
        anchors.top: titlebar.bottom; anchors.bottom: playback.top; width: parent.width; clip: true
        Item {
            anchors.centerIn: parent; width: 500; height: 244; anchors.verticalCenterOffset: -21
            visible: s.frameCount===0
            Canvas {
                width:112; height:112; anchors.horizontalCenter: parent.horizontalCenter
                onPaint: {
                    var c=getContext("2d"); c.reset(); c.strokeStyle="#66808a";c.lineWidth=2.5;c.lineJoin="round"
                    c.beginPath();c.moveTo(30,10);c.lineTo(66,10);c.lineTo(86,30);c.lineTo(86,94);c.quadraticCurveTo(86,102,78,102);c.lineTo(30,102);c.quadraticCurveTo(22,102,22,94);c.lineTo(22,18);c.quadraticCurveTo(22,10,30,10);c.stroke()
                    c.beginPath();c.moveTo(66,10);c.lineTo(66,30);c.lineTo(86,30);c.stroke();c.strokeRect(34,42,40,28)
                    c.beginPath();c.arc(45,50,3,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(35,66);c.lineTo(45,56);c.lineTo(53,63);c.lineTo(62,51);c.lineTo(73,66);c.stroke()
                    c.fillStyle="#66808a";c.font="16px sans-serif";c.textAlign="center";c.fillText("EXR",54,90)
                }
            }
            Text { y:134; anchors.horizontalCenter: parent.horizontalCenter; text:"将 EXR 文件或序列文件夹拖放到此处";color:"#666";font.pixelSize:16 }
            OwlButton { y:178; width:104; height:34; anchors.horizontalCenter:parent.horizontalCenter;text:"浏览文件";onClicked:files.open();background:Rectangle{radius:4;color:parent.hovered?"#378ba5":"#2c778e"} }
        }
        Image {
            id: frameImage
            objectName: "frameImage"
            visible: !s.grid && s.frameCount>0 && !s.gpuActive
            width: canvas.width*win.zoom; height:canvas.height*win.zoom
            x:(canvas.width-width)/2+win.panX; y:(canvas.height-height)/2+win.panY
            fillMode:Image.PreserveAspectFit; source:s.gpuActive ? "" : viewer.imageSource; cache:false; smooth:false
        }
        GpuCanvas {
            anchors.fill:parent
            visible: !s.grid && s.gpuActive
            controller: viewer
            zoom: win.zoom; panX: win.panX; panY: win.panY
        }
        GridView {
            id: grid
            visible:s.grid; anchors.fill:parent; anchors.margins:12; clip:true
            cellWidth:width/Math.max(1,Math.floor((width+8)/238));cellHeight:(cellWidth-8)/1.6+34
            model:s.layers
            ScrollBar.vertical:ScrollBar{width:7}
            delegate:Rectangle {
                required property int index
                required property var modelData
                width:grid.cellWidth-8;height:grid.cellHeight-8;radius:3;color:"#202020";border.color:index===s.selected?"#6499a8":"#303030"
                Image{anchors.top:parent.top;width:parent.width;height:parent.height-26;source:modelData.image;cache:false;fillMode:Image.PreserveAspectFit}
                Text{x:8;y:parent.height-20;width:parent.width-60;text:modelData.label;font.pixelSize:11;color:"#bcbcbc";elide:Text.ElideRight}
                Text{anchors.right:parent.right;anchors.rightMargin:8;y:parent.height-18;text:modelData.color?"RGB":"DATA";font.pixelSize:9;color:"#666"}
                MouseArea{anchors.fill:parent;onClicked:act("layer",index)}
            }
        }
        MouseArea {
            anchors.fill:parent; visible:!s.grid; acceptedButtons:Qt.LeftButton|Qt.MiddleButton|Qt.RightButton
            property real startX:0;property real startY:0;property real oldX:0;property real oldY:0
            property int pressWinX:0;property int pressWinY:0
            property int startGX:0;property int startGY:0
            property bool dragging:false
            onPressed:(mouse)=>{
                startX=oldX=mouse.x;startY=oldY=mouse.y
                if(mouse.button===Qt.RightButton){
                    dragging=false;pressWinX=win.x;pressWinY=win.y
                    var g=mapToGlobal(mouse.x,mouse.y);startGX=g.x;startGY=g.y
                }
            }
            onPositionChanged:(mouse)=>{
                if(!pressed)return
                if(pressedButtons&Qt.RightButton){
                    var g=mapToGlobal(mouse.x,mouse.y);var dx=g.x-startGX,dy=g.y-startGY
                    if(!dragging&&Math.abs(dx)+Math.abs(dy)<5)return
                    dragging=true
                    if(win.visibility!==Window.Maximized&&!win.full){win.x=pressWinX+dx;win.y=pressWinY+dy}
                    return
                }
                var dx=mouse.x-oldX,dy=mouse.y-oldY
                if((pressedButtons&Qt.MiddleButton)||(mouse.modifiers&Qt.AltModifier)){win.panX+=dx;win.panY+=dy}
                else if(s.frameCount>1&&Math.abs(mouse.x-startX)>=3){act("step",Math.trunc((mouse.x-startX)/3));startX=mouse.x}
                oldX=mouse.x;oldY=mouse.y
            }
            onReleased:(mouse)=>{if(mouse.button===Qt.RightButton&&!dragging)menuAt(mouse.x,mouse.y+titlebar.height)}
            onWheel:(wheel)=>{
                var previous=win.zoom;win.zoom=Math.max(.02,Math.min(100,win.zoom*Math.pow(1.15,wheel.angleDelta.y/120)))
                var ratio=win.zoom/previous
                win.panX=(win.panX-(wheel.x-canvas.width/2))*ratio+(wheel.x-canvas.width/2)
                win.panY=(win.panY-(wheel.y-canvas.height/2))*ratio+(wheel.y-canvas.height/2)
            }
        }
        // Leave the empty-state buttons above the canvas interaction surface.
        Item {
            visible:s.frameCount===0;anchors.centerIn:parent;anchors.verticalCenterOffset:-21;width:500;height:244
            OwlButton{y:178;width:104;height:34;anchors.horizontalCenter:parent.horizontalCenter;text:"浏览文件";onClicked:files.open();background:Rectangle{radius:4;color:parent.hovered?"#378ba5":"#2c778e"}}
        }
        MouseArea {
            anchors.fill:parent; visible:s.grid; acceptedButtons:Qt.RightButton
            property int pressWinX:0;property int pressWinY:0
            property int startGX:0;property int startGY:0
            property bool dragging:false
            onPressed:(mouse)=>{
                dragging=false;pressWinX=win.x;pressWinY=win.y
                var g=mapToGlobal(mouse.x,mouse.y);startGX=g.x;startGY=g.y
            }
            onPositionChanged:(mouse)=>{
                if(!pressed)return
                var g=mapToGlobal(mouse.x,mouse.y);var dx=g.x-startGX,dy=g.y-startGY
                if(!dragging&&Math.abs(dx)+Math.abs(dy)<5)return
                dragging=true
                if(win.visibility!==Window.Maximized&&!win.full){win.x=pressWinX+dx;win.y=pressWinY+dy}
            }
            onReleased:(mouse)=>{if(!dragging)menuAt(mouse.x,mouse.y+titlebar.height)}
        }
        Text {
            id:hints
            visible:s.showHints
            anchors.right:parent.right;anchors.rightMargin:18;anchors.bottom:parent.bottom;anchors.bottomMargin:13
            text:"S · 切换图层　 A · 通道网格　 F · 适应窗口\nAlt＋左键 / 中键 · 平移　 右键拖动 · 移动窗口\n滚轮 · 缩放　 Ctrl O · 打开\n1 / 2 / 3 / 4 · 分辨率\nCtrl F · 全屏　 Ctrl T · 置顶"+(s.frameCount>1?"\n左键拖动 · 定位帧　 ← → · 逐帧\nSpace · 播放 / 暂停　 R · 从首帧重播":"")
            color:"#aaaaaa";opacity:.42;font.pixelSize:11;lineHeight:1.9;horizontalAlignment:Text.AlignRight
        }
        Rectangle {
            visible:s.showInfo&&!s.grid&&s.image!==""
            x:18;y:s.showHints&&canvas.width<820?hints.y-30:canvas.height-36
            width:Math.min(info.implicitWidth+18,canvas.width-(s.showHints&&canvas.width>=820?400:36));height:22;radius:3;color:"#b8181818"
            Text{id:info;anchors.fill:parent;anchors.margins:6;leftPadding:3;text:s.info;font.pixelSize:10;color:"#aaa";elide:Text.ElideRight}
        }
        Rectangle {anchors.fill:parent;visible:s.opening;color:"#eb181818";MouseArea{anchors.fill:parent}
            Row {anchors.centerIn:parent;spacing:12;BusyIndicator{width:24;height:24;running:s.opening} Text{anchors.verticalCenter:parent.verticalCenter;text:"正在读取 EXR…";color:"#aaa"}}
        }
        DropArea{anchors.fill:parent;onDropped:(drop)=>{if(drop.hasUrls){fitImage();viewer.open(drop.urls[0])}}}
    }
    Rectangle {
        id:playback
        width:parent.width;height:s.frameCount>1?40:0;visible:height>0;anchors.bottom:parent.bottom;color:"#202020"
        Rectangle{height:1;width:parent.width;color:"#333"}
        RowLayout{
            anchors.fill:parent;anchors.leftMargin:12;anchors.rightMargin:12;spacing:7
            IconButton{glyph:"previous";hint:"上一帧 · ←";Layout.preferredWidth:30;quiet:true;onClicked:act("step",-1)}
            IconButton{glyph:s.playing?"pause":"play";hint:s.playing?"暂停 · Space":"播放 · Space";Layout.preferredWidth:32;quiet:true;onClicked:act("play")}
            IconButton{glyph:"next";hint:"下一帧 · →";Layout.preferredWidth:30;quiet:true;onClicked:act("step",1)}
            Caption{text:viewer.frameNumber+" / "+s.lastFrame;Layout.preferredWidth:95;color:"#bcbcbc";horizontalAlignment:Text.AlignHCenter}
            Slider{
                id:scrubber;Layout.fillWidth:true;from:0;to:Math.max(0,s.frameCount-1);stepSize:1;value:viewer.frameIndex
                onMoved:act("seek",Math.round(value))
                background:Rectangle{x:scrubber.leftPadding;y:scrubber.topPadding+scrubber.availableHeight/2-1.5;width:scrubber.availableWidth;height:3;radius:1.5;color:"#505050"}
                handle:Rectangle{x:scrubber.leftPadding+scrubber.visualPosition*(scrubber.availableWidth-width);y:scrubber.topPadding+scrubber.availableHeight/2-height/2;width:10;height:10;radius:5;color:"#80afbd"}
            }
            OwlCombo{Layout.preferredWidth:70;model:["full","1/2","1/3","1/4","1/8"];currentIndex:[1,2,3,4,8].indexOf(s.divisor);onActivated:act("resolution",[1,2,3,4,8][currentIndex])}
            OwlCombo{Layout.preferredWidth:80;model:["12 fps","24 fps","25 fps","30 fps","60 fps"];currentIndex:[12,24,25,30,60].indexOf(s.fps);onActivated:act("fps",[12,24,25,30,60][currentIndex])}
            IconButton{glyph:"loop";hint:s.loop?"循环播放：开启":"循环播放：关闭";Layout.preferredWidth:30;quiet:true;selected:s.loop;Accessible.checkable:true;Accessible.checked:s.loop;onClicked:act("loop",!s.loop)}
        }
    }
    Popup {
        id:menu
        objectName:"previewMenu"
        property real anchorX:8
        property real anchorY:8
        readonly property real channelHeight:componentRow.implicitHeight+7+channelList.preferredHeight
        readonly property real pageHeight:menuPage===0?channelHeight:settingsContent.implicitHeight
        width:Math.min(308,win.width*.9)
        height:Math.min(win.height-16,topPadding+bottomPadding+menuTabs.implicitHeight+15+pageHeight)
        x:Math.max(8,Math.min(anchorX,win.width-width-8))
        y:Math.max(8,Math.min(anchorY,win.height-height-8))
        padding:10;closePolicy:Popup.CloseOnEscape|Popup.CloseOnPressOutside
        onOpened:channelList.positionViewAtIndex(s.selected,ListView.Contain)
        background:Rectangle{radius:5;color:"#252525";border.color:"#484848"}
        ColumnLayout {
            anchors.fill:parent;spacing:7
            RowLayout {id:menuTabs;Layout.fillWidth:true;spacing:5
                Repeater{model:["通道","显示设置","设置"];delegate:OwlButton{required property int index;required property string modelData;Layout.fillWidth:true;Layout.preferredWidth:1;implicitHeight:32;text:modelData;selected:menuPage===index;font.pixelSize:12;onClicked:{menuPage=index;if(index===0)channelList.positionViewAtIndex(s.selected,ListView.Contain)}}}
            }
            Rectangle{Layout.fillWidth:true;Layout.preferredHeight:1;color:"#3b3b3b"}
            ColumnLayout{
                visible:menuPage===0;Layout.fillWidth:true;Layout.fillHeight:true;spacing:7
                RowLayout{id:componentRow;Layout.fillWidth:true;spacing:4
                    Repeater{model:s.components;delegate:OwlButton{required property var modelData;Layout.fillWidth:true;Layout.preferredWidth:1;implicitHeight:27;text:modelData.name;enabled:modelData.available;selected:s.component===modelData.name;font.pixelSize:11;onClicked:act("component",modelData.name)}}
                }
                ListView{
                    id:channelList
                    readonly property real preferredHeight:Math.min(count,10)*32+Math.max(0,Math.min(count,10)-1)*7
                    Layout.fillWidth:true;Layout.fillHeight:true;Layout.preferredHeight:preferredHeight;Layout.maximumHeight:preferredHeight
                    clip:true;spacing:7;model:s.layers;currentIndex:s.selected
                    boundsBehavior:Flickable.StopAtBounds;snapMode:ListView.SnapToItem
                    ScrollBar.vertical:ScrollBar{id:channelBar;policy:ScrollBar.AsNeeded}
                    delegate:OwlButton{
                        required property int index;required property var modelData
                        width:channelList.width-(channelBar.visible?12:0);height:32
                        selected:s.selected===index;quiet:!selected;onClicked:act("layer",index)
                        contentItem:Text{text:modelData.label;elide:Text.ElideRight;font.pixelSize:12;color:"#bcbcbc";verticalAlignment:Text.AlignVCenter}
                        ToolTip.visible:hovered;ToolTip.text:modelData.label;ToolTip.delay:500
                    }
                }
            }
            ScrollView{
                id:pageScroll
                visible:menuPage!==0;Layout.fillWidth:true;Layout.fillHeight:true;Layout.minimumHeight:0;clip:true
                contentWidth:availableWidth;contentHeight:settingsContent.implicitHeight
                ColumnLayout{
                    id:settingsContent
                    width:pageScroll.availableWidth;spacing:7
                    ColumnLayout{
                        visible:menuPage===1;Layout.fillWidth:true;spacing:9
                        RowLayout{Layout.fillWidth:true;Caption{text:"显示变换";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:188;model:["基础 sRGB / 数据 Raw","OCIO / 数据 Raw","全部 Raw","范围映射"];currentIndex:s.mode;onActivated:act("mode",currentIndex)}}
                        RowLayout{Layout.fillWidth:true;Caption{text:"曝光";Layout.fillWidth:true} Slider{Layout.preferredWidth:150;from:-8;to:8;value:s.exposure;onMoved:act("exposure",value)} Caption{text:Number(s.exposure).toFixed(2);Layout.preferredWidth:32}}
                        ColumnLayout{
                            visible:s.mode===1;Layout.fillWidth:true;spacing:7
                            Caption{text:s.colorSelection.source==="builtin"?"内置 ACES 1.3":s.colorSelection.source;Layout.fillWidth:true;elide:Text.ElideMiddle}
                            RowLayout{OwlButton{text:"加载 .ocio…";font.pixelSize:11;onClicked:ocioFile.open()} OwlButton{text:"内置";font.pixelSize:11;onClicked:act("colorSource","builtin")}}
                            RowLayout{Layout.fillWidth:true;Caption{text:"输入空间";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:188;model:s.colorCatalog.spaces||[];currentIndex:model.indexOf(s.colorSelection.input);onActivated:act("colorInput",currentText)}}
                            RowLayout{Layout.fillWidth:true;Caption{text:"Display";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:188;model:Object.keys(s.colorCatalog.displays||{});currentIndex:model.indexOf(s.colorSelection.display);onActivated:act("colorDisplay",currentText)}}
                            RowLayout{Layout.fillWidth:true;Caption{text:"View";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:188;model:(s.colorCatalog.displays||{})[s.colorSelection.display]||[];currentIndex:model.indexOf(s.colorSelection.view);onActivated:act("colorView",currentText)}}
                            RowLayout{Layout.fillWidth:true;Caption{text:"Look";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:188;model:["跟随配置","无 Look"].concat(s.colorCatalog.looks||[]);currentIndex:s.colorSelection.lookMode==="config"?0:s.colorSelection.lookMode==="none"?1:model.indexOf(s.colorSelection.look);onActivated:act("colorLook",currentText)}}
                            Caption{text:s.colorBusy?"正在生成色彩资源…":"请按素材实际色彩空间选择输入。";wrapMode:Text.Wrap;Layout.fillWidth:true}
                        }
                    }
                    ColumnLayout{
                        visible:menuPage===2;Layout.fillWidth:true;spacing:8
                        RowLayout{Layout.fillWidth:true;Caption{text:"图像缓存";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:115;model:["自动","手动上限"];currentIndex:s.cacheAutomatic?0:1;onActivated:act("cacheAutomatic",currentIndex===0)}}
                        RowLayout{visible:!s.cacheAutomatic;Layout.fillWidth:true
                            Caption{text:"内存上限";Layout.fillWidth:true}
                            TextField{id:cacheInput;Layout.preferredWidth:115;implicitHeight:27;rightPadding:29;text:String(s.manualCacheGiB);font.pixelSize:11;selectByMouse:true
                                validator:DoubleValidator{bottom:.125;top:64}
                                onEditingFinished:if(acceptableInput)act("cache",Number(text))
                                Caption{anchors.right:parent.right;anchors.rightMargin:7;anchors.verticalCenter:parent.verticalCenter;text:"GiB";font.pixelSize:10}
                            }
                        }
                        Caption{text:s.cacheAutomatic?"当前上限 "+Number(s.cacheGiB).toFixed(2)+" GiB · 按需占用":"缓存已读取的图像，减少重复解码。";font.pixelSize:10;Layout.fillWidth:true;wrapMode:Text.Wrap}
                        RowLayout{Layout.fillWidth:true;Caption{text:"打开时分辨率";Layout.fillWidth:true} OwlCombo{Layout.preferredWidth:115;model:["full","1/2","1/3","1/4","1/8"];currentIndex:[1,2,3,4,8].indexOf(s.defaultDivisor);onActivated:act("defaultResolution",[1,2,3,4,8][currentIndex])}}
                        SettingsDivider{}
                        HintCheck{text:"显示快捷键提示";checked:s.showHints;onToggled:act("showHints",checked)}
                        HintCheck{text:"显示图像信息";checked:s.showInfo;onToggled:act("showInfo",checked)}
                        SettingsDivider{}
                        RowLayout{Layout.fillWidth:true;spacing:8
                            OwlButton{
                                id:recordButton;text:s.logging?"停止记录":"记录日志";onClicked:act("recordPerformance")
                                Accessible.name:text
                                ToolTip.visible:hovered
                                ToolTip.delay:500
                                ToolTip.text:"开始记录操作性能调度，在记录期间请尝试打开/播放/切换通道/等操作，用于排查性能问题。结束后关闭即可。"
                                contentItem:Item{
                                    implicitWidth:recordLabel.implicitWidth+18;implicitHeight:18
                                    Row{anchors.centerIn:parent;spacing:8
                                        Rectangle{width:9;height:9;radius:s.logging?0:4.5;color:"#eb6262";anchors.verticalCenter:parent.verticalCenter}
                                        Text{id:recordLabel;text:recordButton.text;color:"#bcbcbc";font.pixelSize:11;anchors.verticalCenter:parent.verticalCenter}
                                    }
                                }
                            }
                            Item{Layout.fillWidth:true}
                            OwlButton{text:"打开目录";quiet:true;font.pixelSize:10;onClicked:act("logs")}
                        }
                        Caption{text:s.status;visible:text!=="";Layout.fillWidth:true;elide:Text.ElideRight;font.pixelSize:10;color:"#7f9298";ToolTip.visible:statusHover.hovered;ToolTip.text:text;HoverHandler{id:statusHover}}
                    }
                }
            }
        }
    }
    Popup{
        id:errorBox;anchors.centerIn:Overlay.overlay;width:Math.min(540,win.width*.8);padding:24;modal:true;closePolicy:Popup.NoAutoClose
        visible:s.error!==""
        background:Rectangle{radius:5;color:"#292522";border.color:"#675045"}
        contentItem:ColumnLayout{spacing:16
            Text{text:"操作未完成";color:"#d7c1b2";font.pixelSize:15}
            Text{text:s.error;Layout.fillWidth:true;wrapMode:Text.WrapAnywhere;color:"#d7c1b2"}
            RowLayout{OwlButton{text:"复制详情";quiet:true;onClicked:act("copyError")} Item{Layout.fillWidth:true} OwlButton{text:"关闭";Layout.preferredWidth:92;onClicked:act("clearError")}}
        }
    }
    FileDialog{id:files;title:"打开 EXR";nameFilters:["OpenEXR (*.exr)"];onAccepted:{fitImage();viewer.open(selectedFile)}}
    FileDialog{id:ocioFile;title:"加载 OCIO 配置";nameFilters:["OCIO (*.ocio *.ocioz)"];onAccepted:act("colorSource",selectedFile.toString())}
    Shortcut{sequence:"Ctrl+O";onActivated:files.open()}
    Shortcut{sequence:"Ctrl+F";onActivated:win.fullScreen()}
    Shortcut{sequence:"Ctrl+T";onActivated:win.pinWindow()}
    Shortcut{sequence:"Escape";onActivated:{if(menu.opened)menu.close();else if(win.full)win.showNormal()}}
    Repeater{
        model:[{key:"S",action:"nextLayer"},{key:"A",action:"grid"},{key:"Space",action:"play"},{key:"R",action:"restart"},{key:"Left",action:"step",value:-1},{key:"Right",action:"step",value:1},{key:"1",action:"resolution",value:1},{key:"2",action:"resolution",value:2},{key:"3",action:"resolution",value:3},{key:"4",action:"resolution",value:4}]
        delegate:Item{required property var modelData;Shortcut{sequence:modelData.key;enabled:!menu.opened&&!errorBox.visible;onActivated:act(modelData.action,modelData.value)}}
    }
    Shortcut{sequence:"F";enabled:!menu.opened;onActivated:fitImage()}
    // Corners pass two adjacent edges to the native resize operation.
    Repeater{
        model:[Qt.LeftEdge,Qt.RightEdge,Qt.TopEdge,Qt.BottomEdge,
            Qt.LeftEdge|Qt.TopEdge,Qt.RightEdge|Qt.TopEdge,
            Qt.LeftEdge|Qt.BottomEdge,Qt.RightEdge|Qt.BottomEdge]
        delegate:MouseArea{
            required property int modelData
            readonly property bool horizontalEdge:(modelData&(Qt.LeftEdge|Qt.RightEdge))!==0
            readonly property bool verticalEdge:(modelData&(Qt.TopEdge|Qt.BottomEdge))!==0
            readonly property bool corner:horizontalEdge&&verticalEdge
            readonly property int cornerSize:12
            visible:!win.full&&win.visibility!==Window.Maximized
            enabled:visible;acceptedButtons:Qt.LeftButton;hoverEnabled:true
            z:100
            x:(modelData&Qt.RightEdge)?win.width-width:(horizontalEdge?0:cornerSize)
            y:(modelData&Qt.BottomEdge)?win.height-height:(verticalEdge?0:cornerSize)
            width:corner?cornerSize:horizontalEdge?4:win.width-2*cornerSize
            height:corner?cornerSize:verticalEdge?4:win.height-2*cornerSize
            cursorShape:corner?((modelData===(Qt.LeftEdge|Qt.TopEdge)||modelData===(Qt.RightEdge|Qt.BottomEdge))?Qt.SizeFDiagCursor:Qt.SizeBDiagCursor):horizontalEdge?Qt.SizeHorCursor:Qt.SizeVerCursor
            onPressed:win.startSystemResize(modelData)
        }
    }
}
