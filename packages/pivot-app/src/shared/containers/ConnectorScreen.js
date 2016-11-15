import React from 'react';
import _ from 'underscore';
import {
    BootstrapTable,
    TableHeaderColumn
} from 'react-bootstrap-table';
import {
    ButtonGroup,
    Button,
    Glyphicon,
    Panel,
    Grid,
    Row,
    Col,
    Image,
    Media,
    Label,
    OverlayTrigger,
    Tooltip
} from 'react-bootstrap';
import { switchScreen } from '../actions/app';
import {
    checkStatus
} from '../actions/connectorScreen.js';
import { container } from '@graphistry/falcor-react-redux';
import Sidebar from './Sidebar.js';
import styles from './styles.less';
import logger from '../logger.js';
const log = logger.createLogger('pivot-app', __filename);


function welcomeBar(user, connectors) {
    return (
        <Grid><Row className={styles['welcome-bar']}>
            <Col md={4}>
                <Panel>
                    <Media.Left align="middle">
                        <Image width={84}
                            height={84}
                            src="/custom/img/abstract-user-flat-3.svg"
                            className={styles['user-icon']}
                            circle/>
                    </Media.Left>
                    <Media.Body>
                        <Media.Heading className={styles['user-greeting-heading']}>
                            Connectors!
                        </Media.Heading>
                        <span className={styles['user-greeting-message']}>
                            Welcome, {user.name}!
                        </span>
                    </Media.Body>
                </Panel>
             </Col>
            <Col md={4}>
                <Panel>
                    <h2 className="text-center">{connectors.length}</h2>
                    <div className="text-center">
                         Number of Connectors
                    </div>
                </Panel>
            </Col>
            <Col md={4}>
                <Panel>
                    <h2 className="text-center">1/2</h2>
                    <div className="text-center">
                        Active Connectors
                    </div>
                </Panel>
            </Col>
        </Row></Grid>
    );
}

function connectorTable({user, connectors = [], switchScreen, selectHandler, checkStatus}) {
    function tagsFormatter(tags, row) {
        return (
            <p> {
                tags.map(tag => (
                    <Label key={`ilisttags-${row.id}-${tag}`}> { tag } </Label>
                ))
            } </p>
        );
    }

    function nameFormatter(name, row) {
        return (<a href="#">
                    { name }
                </a>);
    }
    //function descriptionFormatter(description, row) {
    //    return nameFormatter(description, row);
    //}

    function idFormatter(id, row) {
        return (
            <div>
                <Button bsStyle={row.status} onClick={() => checkStatus(id)}>
                    Status
                </Button>
            </div>
        );
    }

    function dateFormatter(epoch, row) {
        return (new Date(epoch)).toLocaleString()
    }

    function selectAllHandler(selected, rows) {
        selectHandler(rows, selected);
    }

    const selectRowProp = {
        mode: 'checkbox',
        clickToSelect: false,
        onSelect: selectHandler,
        onSelectAll: selectAllHandler,
        bgColor: '#fee'
    };

    return (
        <div className={styles['investigation-table']}>
            <BootstrapTable data={connectors.filter(Boolean)}
                            selectRow={selectRowProp}
                            striped={false}
                            hover={true}
                            pagination={true}
                            options={{defaultSortName: 'name', defaultSortOrder: 'desc'}}>
                <TableHeaderColumn dataField="id" isKey={true} hidden={true} editable={false}/>
                <TableHeaderColumn dataField="name" dataSort={true} width="200px" dataFormat={nameFormatter}>
                    Name
                </TableHeaderColumn>
                <TableHeaderColumn dataField="description">
                    Description
                </TableHeaderColumn>
                <TableHeaderColumn dataField="lastUpdated" dataSort={true} editable={false}
                                   dataFormat={dateFormatter} width="180px" dataAlign="center">
                    Updated
                </TableHeaderColumn>

                {/*
                <TableHeaderColumn dataField="tags" dataFormat={tagsFormatter} editable={false}>
                    Tags
                </TableHeaderColumn>
                */}

                <TableHeaderColumn dataField="id" dataFormat={idFormatter} width='172px' editable={false}>
                    Actions
                </TableHeaderColumn>
            </BootstrapTable>
        </div>
   );

}

function renderConnectorScreen({ user, connectors, switchScreen, checkStatus },
                          { selection }, selectHandler ) {
    if (user === undefined) {
        return null;
    }

    return (
        <div className="wrapper">
            <Sidebar activeScreen='home'/>
            <div className={`main-panel ${styles['main-panel']}`}
                 style={{width: 'calc(100% - 90px)', height: '100%'}}>
                <Panel className={styles['main-panel-panel']}>
                    {
                        welcomeBar(user, connectors)
                    }
                    <Panel header="Available Connectors" className={styles['panel']}>
                        <div className={styles['investigations-buttons']}>
                            <OverlayTrigger placement="top"
                                            overlay={
                                                <Tooltip id="AddNewConnectorTooltip">
                                                    Add New Connector
                                                </Tooltip>
                                            }>
                                <Button onClick={() => createConnector()}
                                        className={`btn-primary ${styles['add-new-investigation']}`}>
                                    <Glyphicon glyph="plus"/>
                                </Button>
                            </OverlayTrigger>
                        </div>
                        {
                            connectorTable({
                                user, connectors, switchScreen, checkStatus
                            })
                        }
                    </Panel>
                </Panel>
            </div>
        </div>
    );
}

class ConnectorScreen extends React.Component {
    constructor(props, context) {
        super(props, context);
        this.state = {
            selection: []
        }
    }

    render() {
        return renderConnectorScreen(
            this.props,
            this.state,
            this.selectHandler.bind(this),
        );
    }

    selectHandler(row, selected) {
        const ids = Array.isArray(row) ? row.map(x => x.id) : [row.id];
        const selection = this.state.selection;
        const newSelection = selected ? selection.concat(ids)
                                      : _.reject(selection, (x) => ids.includes(x))
        this.setState({
            selection: newSelection
        });
    }
}

function mapStateToFragment({currentUser: { connectors = [] } = {} }) {
    return `{
        currentUser: {
            'name', 'id',
            connectors: {
                'length',
                [0...${connectors.length}]: {
                    'id',
                    'name',
                    'lastUpdated',
                    'status'
                }
            }
        }
    }`
}

function mapFragmentToProps({ currentUser } = {}) {
    return {
        user: currentUser,
        connectors: (currentUser || {}).connectors || []
    };
}

export default container({
    renderLoading: false,
    fragment: mapStateToFragment,
    mapFragment: mapFragmentToProps,
    dispatchers: {
        switchScreen: switchScreen,
        checkStatus: checkStatus
    }
})(ConnectorScreen);
