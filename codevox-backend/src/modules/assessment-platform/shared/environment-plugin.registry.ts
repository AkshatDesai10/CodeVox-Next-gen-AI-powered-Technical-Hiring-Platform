import { Injectable } from '@nestjs/common';
import type { EnvironmentProvisioner } from '../shared/interfaces';

export type EnvironmentPlugin = {
  id: string;
  supportedServices: string[];
  provisioner: EnvironmentProvisioner;
};

@Injectable()
export class EnvironmentPluginRegistry {
  private readonly plugins = new Map<string, EnvironmentPlugin>();

  register(plugin: EnvironmentPlugin) {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string) {
    return this.plugins.get(id);
  }

  list() {
    return [...this.plugins.values()];
  }
}
