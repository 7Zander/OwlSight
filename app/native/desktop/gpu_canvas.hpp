// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "viewer.hpp"
#include <QQuickRhiItem>
#include <QPointer>

class GpuCanvas : public QQuickRhiItem {
    Q_OBJECT
    Q_PROPERTY(Viewer* controller READ viewer WRITE setViewer NOTIFY viewerChanged)
    Q_PROPERTY(qreal zoom READ zoom WRITE setZoom NOTIFY viewChanged)
    Q_PROPERTY(qreal panX READ panX WRITE setPanX NOTIFY viewChanged)
    Q_PROPERTY(qreal panY READ panY WRITE setPanY NOTIFY viewChanged)
public:
    explicit GpuCanvas(QQuickItem* parent=nullptr);
    Viewer* viewer() const { return viewer_; }
    void setViewer(Viewer*);
    qreal zoom() const { return zoom_; }
    qreal panX() const { return panX_; }
    qreal panY() const { return panY_; }
    void setZoom(qreal);
    void setPanX(qreal);
    void setPanY(qreal);
signals:
    void viewerChanged();
    void viewChanged();
    void submitted(quint64 serial, quint64 generation, const QString& key, const QVariantMap& timing);
    void unavailable(const QString& reason);
    void cacheStatistics(const QVariantMap& data);
protected:
    QQuickRhiItemRenderer* createRenderer() override;
private:
    QPointer<Viewer> viewer_;
    qreal zoom_=1, panX_=0, panY_=0;
};
