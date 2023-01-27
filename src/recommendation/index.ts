// Copyright (c) Microsoft Corporation. All rights reserved.

'use strict'

import { ExtensionContext } from 'coc.nvim'
import { HandlerImpl } from './handlerImpl'
import { initialize as initDependencyAnalytics } from './dependencyAnalytics'

export function initialize(context: ExtensionContext) {
  const handler = new HandlerImpl(context)
  initDependencyAnalytics(context, handler)
}
