import {CloseAction, commands, ErrorAction, ErrorHandler, Message, window} from 'coc.nvim'
import {Commands} from './commands'
import {createLogger, ILogger} from './log'

export class ClientErrorHandler implements ErrorHandler {
    private restarts: number[]
    private logger: ILogger

    constructor(private name: string) {
        this.restarts = []
        this.logger = createLogger()
    }

    public error(_error: Error, _message: Message, count: number): ErrorAction {
        if (count && count <= 3) {
            this.logger.error(`${this.name} server encountered error: ${_message}, ${_error && _error.toString()}`)
            return ErrorAction.Continue
        }

        this.logger.error(`${this.name} server encountered error and will shut down: ${_message}, ${_error && _error.toString()}`)
        return ErrorAction.Shutdown
    }

    public closed(): CloseAction {
        this.restarts.push(Date.now())
        if (this.restarts.length < 5) {
            this.logger.error(`The ${this.name} server crashed and will restart.`)
            return CloseAction.Restart
        } else {
            const diff = this.restarts[this.restarts.length - 1] - this.restarts[0]
            if (diff <= 3 * 60 * 1000) {
                const message = `The ${this.name} server crashed 5 times in the last 3 minutes. The server will not be restarted.`
                this.logger.error(message)
                const action = "Show logs"
                window.showErrorMessage(message, action).then(selection => {
                    if (selection === action) {
                        commands.executeCommand(Commands.OPEN_LOGS)
                    }
                })
                return CloseAction.DoNotRestart
            }

            this.logger.error(`The ${this.name} server crashed and will restart.`)
            this.restarts.shift()
            return CloseAction.Restart
        }
    }
}
