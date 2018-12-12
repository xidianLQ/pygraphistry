COMPOSE_FILE=$(CURDIR)/compose/docker-compose.yml
CONDA_PYGRAPHISTRY_ENV_FILE=$(CURDIR)/environment.yml

include ./.env

chown:
	sudo chown -R $(shell whoami) .

test: chown
	docker-compose -f $(COMPOSE_FILE) build
	docker-compose -f $(COMPOSE_FILE) run --rm test bash -c "/pygraphistry/run-tests.sh"

jupyter: chown
	docker-compose -f $(COMPOSE_FILE) build
	docker-compose -f $(COMPOSE_FILE) up jupyter
	docker-compose -f $(COMPOSE_FILE) exec jupyter bash -c 'source activate graphistry ; pip install -e /opt/graphistry-environment.yml'

echo:
	echo $(CURDIR)