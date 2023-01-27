import { OutputChannel, window } from 'coc.nvim'
import { createLogger } from './log'

export class OutputInfoCollector implements OutputChannel {
  private channel: OutputChannel = null;

  constructor(public name: string) {
    this.channel = window.createOutputChannel(name)
  }

  public get content(): string {
    return this.channel.content
  }

  append(value: string): void {
    createLogger().info(value)
    this.channel.append(value)
  }

  appendLine(value: string): void {
    createLogger().info(value)
    this.channel.appendLine(value)
  }

  replace(value: string): void {
    this.clear()
    this.append(value)
  }

  clear(): void {
    this.channel.clear()
  }

  show(preserveFocus?: boolean): void {
    this.channel.show(preserveFocus)
  }

  hide(): void {
    this.channel.hide()
  }

  dispose(): void {
    this.channel.dispose()
  }
}
