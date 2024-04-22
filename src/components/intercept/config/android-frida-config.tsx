import * as _ from 'lodash';
import * as React from 'react';
import { computed, observable, action, autorun, flow } from 'mobx';
import { observer, inject, disposeOnUnmount } from 'mobx-react';

import { styled } from '../../../styles';

import { Interceptor } from '../../../model/interception/interceptors';
import { ProxyStore } from '../../../model/proxy-store';
import { AccountStore } from '../../../model/account/account-store';
import { EventsStore } from '../../../model/events/events-store';
import { RulesStore } from '../../../model/rules/rules-store';
import { FridaActivationOptions, FridaHost, FridaTarget } from '../../../model/interception/frida';

import { getDetailedInterceptorMetadata } from '../../../services/server-api';

import { TextInput } from '../../common/inputs';
import { Icon } from '../../../icons';
import { InterceptionTargetList } from './intercept-target-list';
import { IconButton } from '../../common/icon-button';

const ConfigContainer = styled.div`
    user-select: text;

    height: 100%;
    max-height: 440px; /* TODO: This ignores narrow layout, and needs work generally to fix scroll area layout (for all list usage) */
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: start;

    > p {
        line-height: 1.2;

        &:not(:last-child) {
            margin-bottom: 5px;
        }

        &:not(:first-child) {
            margin-top: 5px;
        }
    }

    a[href] {
        color: ${p => p.theme.linkColor};

        &:visited {
            color: ${p => p.theme.visitedLinkColor};
        }
    }
`;

const BackAndSearchBlock = styled.div`
    margin: 5px -15px 0;

    display: flex;
    flex-direction: row;
    align-items: stretch;

    z-index: 1;
    box-shadow: 0 0 5px 2px rgba(0,0,0,${p => p.theme.boxShadowAlpha});

`;

const BackButton = styled(IconButton).attrs(() => ({
    icon: ['fas', 'arrow-left'],
    title: 'Jump to this request on the View page'
}))`
    font-size: ${p => p.theme.textSize};
    padding: 2px 10px 0;
`;

const SearchBox = styled(TextInput)`
    flex-grow: 1;

    border: none;
    border-radius: 0;
    padding: 10px 10px 8px;
`;

const Footer = styled.p`
    margin-top: auto;
    font-size: 85%;
    font-style: italic;
`;

@inject('proxyStore')
@inject('rulesStore')
@inject('eventsStore')
@inject('accountStore')
@observer
class AndroidFridaConfig extends React.Component<{
    proxyStore?: ProxyStore,
    rulesStore?: RulesStore,
    eventsStore?: EventsStore,
    accountStore?: AccountStore,

    interceptor: Interceptor,
    activateInterceptor: (options: FridaActivationOptions) => Promise<void>,
    reportStarted: () => void,
    reportSuccess: () => void,
    closeSelf: () => void
}> {

    @computed private get fridaHosts(): Array<FridaHost> {
        return this.props.interceptor.metadata?.hosts || [];
    }

    @observable fridaTargets: Array<FridaTarget> = [];

    updateTargets = flow(function * (this: AndroidFridaConfig) {
        if (!this.selectedHost) {
            this.fridaTargets = [];
            return;
        }

        const result: {
            targets: FridaTarget[]
        } | undefined = (
            yield getDetailedInterceptorMetadata("android-frida", this.selectedHost?.id)
        );

        // TODO: Handle failure (if hosts disappears). ...How does JVM handle this?

        this.fridaTargets = result?.targets ?? [];
    }.bind(this));


    @observable private inProgressHostIds: string[] = [];
    @observable private inProgressTargetIds: string[] = [];

    async componentDidMount() {
        if (this.fridaHosts.length === 1 && this.fridaHosts[0].state === 'available') {
            this.selectHost(this.fridaHosts[0].id);
        }

        disposeOnUnmount(this, autorun(() => {
            if (this.selectedHostId && !this.fridaHosts.some(host => host.id === this.selectedHostId)) {
                this.deselectHost();
            }
        }));

        this.updateTargets();
        const updateInterval = setInterval(this.updateTargets, 2000);
        disposeOnUnmount(this, () => clearInterval(updateInterval));
    }

    @observable selectedHostId: string | undefined;

    @computed
    get selectedHost() {
        if (!this.selectedHostId) return;
        const hosts = this.fridaHosts;
        return this.fridaHosts.find(host => host.id === this.selectedHostId && host.state !== 'unavailable');
    }

    @action.bound
    selectHost(hostId: string) {
        this.selectedHostId = hostId;

        const host = this.selectedHost;
        if (host?.state === 'available') {
            this.searchInput = '';
            this.updateTargets();
        } else if (host?.state === 'launch-required') {
            this.inProgressHostIds.push(hostId);
            this.props.activateInterceptor({
                action: 'launch',
                hostId
            }).finally(action(() => {
                _.pull(this.inProgressHostIds, hostId);
            }));
        } else if (host?.state === 'setup-required') {
            // TODO: Some confirmation or explanation required here I think
            this.inProgressHostIds.push(hostId);
            this.props.activateInterceptor({
                action: 'setup',
                hostId
            }).finally(action(() => {
                _.pull(this.inProgressHostIds, hostId);
            }));
        } else {
            // Should probably never happen, but maybe in some race conditions
            return;
        }
    }

    @action.bound
    deselectHost() {
        this.selectedHostId = undefined;
    }

    @action.bound
    interceptTarget(targetId: string) {
        const host = this.selectedHost;

        if (!host) return;

        this.inProgressTargetIds.push(targetId);
        this.props.activateInterceptor({
            action: 'intercept',
            hostId: host.id,
            targetId
        }).finally(action(() => {
            _.pull(this.inProgressTargetIds, targetId);
        }));
    }

    @observable searchInput: string = '';

    @action.bound
    onSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
        this.searchInput = event.currentTarget.value;
    }

    render() {
        const selectedHost = this.selectedHost;

        const docsFooter = <Footer>
            For more information, see the in-depth <a
                href="https://httptoolkit.com/docs/guides/frida/"
            >Frida interception guide</a>.
        </Footer>; // TODO: This URL doesn't actually exist

        if (selectedHost) {
            const lowercaseSearchInput = this.searchInput.toLowerCase();
            const filteredTargets = this.fridaTargets
                .filter(({ name }) => name.toLowerCase().includes(lowercaseSearchInput));

            // TODO: List needs to show different UI if no results due to filtering
            // rather than basic status. Maybe filtering should be built into the list itself?

            return <ConfigContainer>
                <BackAndSearchBlock>
                    <BackButton onClick={this.deselectHost} />
                    <SearchBox
                        value={this.searchInput}
                        onChange={this.onSearchChange}
                        placeholder='Search for a target...'
                        autoFocus={true}
                    />
                </BackAndSearchBlock>
                <InterceptionTargetList
                    spinnerText='Scanning for Android apps to intercept...'
                    targets={filteredTargets.map(target => {
                            const { id, name } = target;
                            const activating = this.inProgressTargetIds.includes(id);

                            return {
                                id,
                                title: `Android app ${name}`,
                                status: activating
                                        ? 'activating'
                                        : 'available',
                                content: <p>
                                    {
                                        activating
                                            ? <Icon icon={['fas', 'spinner']} spin />
                                            : null
                                    } { name }
                                </p>
                            };
                        })
                    }
                    interceptTarget={this.interceptTarget}
                    ellipseDirection='right'
                />
                { docsFooter }
            </ConfigContainer>;
        }

        // TODO: Button styling (colours?) in list should reflect status somehow
        // TODO: Launch UX needs thought - should be near invisible. Maybe just a 'Launching' spinner
        // then straight to the target list?
        // Setup UX: Brief explanation, click continue => spinner with different statuses => targets
        // How long does this take in practice? Depends on connection but probably < 10 seconds.
        // Main delay is ~10MB download - <1 second on a fast connection.
        return <ConfigContainer>
            <InterceptionTargetList
                spinnerText='Waiting for Android devices to attach to...'
                targets={this.fridaHosts.map(host => {
                    const { id, name, state } = host;
                    const activating = this.inProgressHostIds.includes(id);

                    return {
                        id,
                        title: `Android device ${name} in state ${state}`,
                        status: activating
                                ? 'activating'
                            : state === 'unavailable'
                                ? 'unavailable'
                            // Available here means clickable - interceptable/setupable/launchable
                                : 'available',
                        content: <p>
                            {
                                activating
                                    ? <Icon icon={['fas', 'spinner']} spin />
                                : id.includes("emulator-")
                                    ? <Icon icon={['far', 'window-maximize']} />
                                : id.match(/\d+\.\d+\.\d+\.\d+:\d+/)
                                    ? <Icon icon={['fas', 'network-wired']} />
                                : <Icon icon={['fas', 'mobile-alt']} />
                            } { name }: { state }
                        </p>
                    };
                })}
                interceptTarget={this.selectHost}
                ellipseDirection='right'
            />
            { docsFooter }
        </ConfigContainer>;
    }

    onSuccess = () => {
        this.props.reportSuccess();
    };

}

export const AndroidFridaCustomUi = {
    columnWidth: 2,
    rowHeight: 3,
    configComponent: AndroidFridaConfig
};