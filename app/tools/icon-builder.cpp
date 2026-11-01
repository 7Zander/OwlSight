// SPDX-License-Identifier: GPL-3.0-or-later
#include <QCoreApplication>
#include <QSvgRenderer>
#include <QPainter>
#include <QImage>
#include <QBuffer>
#include <QDataStream>
#include <QFile>
#include <QDebug>
int main(int argc,char** argv){
 QCoreApplication app(argc,argv);const auto args=app.arguments();if(args.size()!=3)return 2;
 QSvgRenderer svg(args[1]);if(!svg.isValid())return 3;
 const QList<int> sizes={16,20,24,32,40,48,64,128,256};QList<QByteArray> images;
 for(int size:sizes){QImage image(size,size,QImage::Format_ARGB32_Premultiplied);image.fill(Qt::transparent);QPainter painter(&image);svg.render(&painter);painter.end();QByteArray png;QBuffer buffer(&png);buffer.open(QIODevice::WriteOnly);if(!image.save(&buffer,"PNG"))return 4;images.push_back(png);}
 QFile file(args[2]);if(!file.open(QIODevice::WriteOnly))return 5;QDataStream out(&file);out.setByteOrder(QDataStream::LittleEndian);out<<quint16(0)<<quint16(1)<<quint16(sizes.size());quint32 offset=6+16*sizes.size();
 for(int i=0;i<sizes.size();++i){out<<quint8(sizes[i]==256?0:sizes[i])<<quint8(sizes[i]==256?0:sizes[i])<<quint8(0)<<quint8(0)<<quint16(1)<<quint16(32)<<quint32(images[i].size())<<offset;offset+=images[i].size();}
 for(const auto& png:images)out.writeRawData(png.constData(),png.size());
 if(out.status()!=QDataStream::Ok)return 6;qInfo()<<"Generated Windows icon:"<<args[2];return 0;
}
