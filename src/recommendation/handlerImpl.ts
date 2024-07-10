// Copyright (c) Microsoft Corporation. All rights reserved.

'use strict'

import {commands, ExtensionContext, extensions, window} from 'coc.nvim'
import {IHandler} from "./handler"

const KEY_RECOMMENDATION_USER_CHOICE_MAP = "recommendationUserChoice"

async function installExtensionCmdHandler(extensionName: string, displayName: string) {
    return window.withProgress({title: `Installing ${displayName || extensionName}...`}, progress => {
        return commands.executeCommand("workbench.extensions.installExtension", extensionName)
    }).then(() => {
        window.showInformationMessage(`Successfully installed ${displayName || extensionName}.`)
    })
}

enum UserChoice {
    install = "Install",
    never = "Never",
    later = "Later",
}

export class HandlerImpl implements IHandler {
    userChoice: any
    storeUserChoice: any
    constructor(context: ExtensionContext) {
        this.userChoice = () => {
            return context.globalState.get(KEY_RECOMMENDATION_USER_CHOICE_MAP, {})
        }

        this.storeUserChoice = (choice: object) => {
            context.globalState.update(KEY_RECOMMENDATION_USER_CHOICE_MAP, choice)
        }
    }

    isExtensionInstalled(extName: string): boolean {
        return !!extensions.getExtensionById(extName)
    }

    canRecommendExtension(extName: string): boolean {
        return this.userChoice()[extName] !== UserChoice.never && !this.isExtensionInstalled(extName)
    }

    async handle(extName: string, message: string): Promise<void> {
        if (this.isExtensionInstalled(extName)) {
            return
        }

        const choice = this.userChoice()
        if (choice[extName] === UserChoice.never) {
            return
        }

        const actions: Array<string> = Object.values(UserChoice)
        const answer = await window.showInformationMessage(message, ...actions)
        if (answer === UserChoice.install) {
            await installExtensionCmdHandler(extName, extName)
        }

        choice[extName] = answer
        this.storeUserChoice(choice)
    }
}
