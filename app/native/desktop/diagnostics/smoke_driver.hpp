// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <QString>
#include <QStringList>
class QGuiApplication;
class QQmlApplicationEngine;
class Viewer;

// Developer-only implementation; excluded from production builds.
QString configureSmokeDriver(const QStringList& arguments);
int runSmokeDriver(QGuiApplication& application, QQmlApplicationEngine& qml,
                   Viewer& viewer, const QString& directory);
