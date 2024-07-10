// Copyright (c) Microsoft Corporation. All rights reserved.

'use strict'

import {workspace, Uri, ExtensionContext} from 'coc.nvim'
import {IHandler} from './handler'

const EXTENSION_NAME = "redhat.fabric8-analytics"
const GH_ORG_URL = `https://github.com/fabric8-analytics`
const RECOMMENDATION_MESSAGE = `Do you want to install the [Dependency Analytics](${GH_ORG_URL}) extension to stay informed about vulnerable dependencies in pom.xml files?`
const JAVA_DEPENDENCY_ANALYTICS_SHOW = "java.recommendations.dependency.analytics.show"

function isPomDotXml(uri: Uri) {
    return !!uri.path && uri.path.toLowerCase().endsWith("pom.xml")
}

export function initialize(context: ExtensionContext, handler: IHandler): void {
    const show = workspace.getConfiguration().get(JAVA_DEPENDENCY_ANALYTICS_SHOW)
    if (true) return
    // TODO
    if (!show) {
        return
    }
    if (!handler.canRecommendExtension(EXTENSION_NAME)) {
        return
    }
    context.subscriptions.push(workspace.onDidOpenTextDocument(e => {
        if (isPomDotXml(Uri.parse(e.uri))) {
            handler.handle(EXTENSION_NAME, RECOMMENDATION_MESSAGE)
        }
    }))

    const isPomDotXmlOpened = workspace.textDocuments.findIndex(doc => isPomDotXml(Uri.parse(doc.uri))) !== -1
    if (isPomDotXmlOpened) {
        handler.handle(EXTENSION_NAME, RECOMMENDATION_MESSAGE)
    }
}
